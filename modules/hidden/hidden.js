/* Moduł: wykrywanie ukrytych treści w dokumentach.
   Obsługuje DOCX (ZIP + XML) i PDF (pdf.js).
   Wszystko dzieje się lokalnie — żadne dane nie wychodzą na sieć. */
(function () {
'use strict';

/* ─────────────────────────────────────────────
   Narzędzia pomocnicze
───────────────────────────────────────────── */

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kb(n) {
  return n < 1024 ? n + ' B' : (n / 1024).toFixed(1).replace('.', ',') + ' KB';
}

function fmtDate(raw) {
  if (!raw) return '';
  try {
    var d = new Date(raw);
    if (isNaN(d)) return raw;
    return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  } catch (e) { return raw; }
}

/* Pobiera tekst z węzła XML (wszystkie węzły tekstowe w drzewie) */
function xmlText(node) {
  if (!node) return '';
  var out = '';
  function walk(n) {
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    for (var i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
  }
  walk(node);
  return out.trim();
}

/* Pobiera atrybut z elementu XML, szukając po lokalnej nazwie (ignoruje namespace) */
function attr(el, localName) {
  if (!el || !el.attributes) return '';
  for (var i = 0; i < el.attributes.length; i++) {
    var a = el.attributes[i];
    if (a.localName === localName || a.name === localName) return a.value;
  }
  return '';
}

/* Parsuje XML z tekstu */
function parseXML(str) {
  var parser = new DOMParser();
  return parser.parseFromString(str, 'application/xml');
}

/* ─────────────────────────────────────────────
   DOCX — parser
───────────────────────────────────────────── */

/*
  Struktura DOCX (ZIP):
    word/document.xml        — treść, ukryty tekst (w:rPr/w:vanish), śledzone zmiany (w:ins, w:del)
    word/comments.xml        — komentarze
    word/commentsExtended.xml — rozszerzone metadane komentarzy (opcjonalne)
    docProps/core.xml        — autor, data, ostatnia modyfikacja
    docProps/app.xml         — aplikacja, firma
*/

async function parseDocx(buf) {
  var result = {
    format: 'DOCX',
    supported: true,
    error: null,
    props: {},          // właściwości dokumentu
    comments: [],       // { id, author, date, text }
    tracked: [],        // { type:'ins'|'del', author, date, text }
    hiddenText: [],     // fragmenty tekstu oznaczone jako ukryty
    formFields: []      // pola formularzy (legacy)
  };

  var zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    result.supported = false;
    result.error = 'Nie udało się otworzyć pliku. Może być uszkodzony lub zabezpieczony hasłem.';
    return result;
  }

  /* ── Właściwości dokumentu ── */
  var coreFile = zip.file('docProps/core.xml');
  if (coreFile) {
    try {
      var coreXml = parseXML(await coreFile.async('string'));
      var pick = function (tag) {
        var el = coreXml.getElementsByTagNameNS('*', tag)[0]
               || coreXml.querySelector(tag);
        return el ? xmlText(el) : '';
      };
      var creator  = pick('creator');
      var modified = pick('lastModifiedBy');
      var created  = pick('created');
      var modDate  = pick('modified');
      var title    = pick('title');
      var subject  = pick('subject');
      var desc     = pick('description');
      if (creator)  result.props['Autor']              = creator;
      if (modified) result.props['Ostatnia modyfikacja przez'] = modified;
      if (created)  result.props['Data utworzenia']    = fmtDate(created);
      if (modDate)  result.props['Data modyfikacji']   = fmtDate(modDate);
      if (title)    result.props['Tytuł']              = title;
      if (subject)  result.props['Temat']              = subject;
      if (desc)     result.props['Opis']               = desc;
    } catch (e) { /* ignoruj błędy parsowania */ }
  }

  var appFile = zip.file('docProps/app.xml');
  if (appFile) {
    try {
      var appXml = parseXML(await appFile.async('string'));
      var company = appXml.querySelector('Company') ||
                    appXml.getElementsByTagNameNS('*', 'Company')[0];
      var appName = appXml.querySelector('Application') ||
                    appXml.getElementsByTagNameNS('*', 'Application')[0];
      if (company && xmlText(company)) result.props['Firma'] = xmlText(company);
      if (appName && xmlText(appName)) result.props['Aplikacja'] = xmlText(appName);
    } catch (e) { /* ignoruj */ }
  }

  /* ── Komentarze ── */
  var commFile = zip.file('word/comments.xml');
  if (commFile) {
    try {
      var commXml = parseXML(await commFile.async('string'));
      var comments = commXml.getElementsByTagNameNS('*', 'comment');
      for (var i = 0; i < comments.length; i++) {
        var c = comments[i];
        var text = '';
        /* Zbierz tekst ze wszystkich w:t wewnątrz komentarza */
        var tNodes = c.getElementsByTagNameNS('*', 't');
        for (var j = 0; j < tNodes.length; j++) {
          text += tNodes[j].textContent || '';
        }
        text = text.trim();
        if (!text) continue;
        result.comments.push({
          id:     attr(c, 'id'),
          author: attr(c, 'author') || 'nieznany',
          date:   fmtDate(attr(c, 'date')),
          text:   text
        });
      }
    } catch (e) { /* ignoruj */ }
  }

  /* ── Treść dokumentu: śledzone zmiany + ukryty tekst ── */
  var docFile = zip.file('word/document.xml');
  if (docFile) {
    try {
      var docXml = parseXML(await docFile.async('string'));

      /* Śledzone wstawienia */
      var insNodes = docXml.getElementsByTagNameNS('*', 'ins');
      for (var i = 0; i < insNodes.length; i++) {
        var ins = insNodes[i];
        /* Pomijamy ins wewnątrz właściwości (rPrChange, pPrChange) */
        if (ins.parentNode && /PrChange/.test(ins.parentNode.localName || '')) continue;
        var tNodes = ins.getElementsByTagNameNS('*', 't');
        var text = '';
        for (var j = 0; j < tNodes.length; j++) text += tNodes[j].textContent || '';
        text = text.trim();
        if (!text) continue;
        result.tracked.push({
          type:   'ins',
          author: attr(ins, 'author') || 'nieznany',
          date:   fmtDate(attr(ins, 'date')),
          text:   text
        });
      }

      /* Śledzone usunięcia */
      var delNodes = docXml.getElementsByTagNameNS('*', 'del');
      for (var i = 0; i < delNodes.length; i++) {
        var del = delNodes[i];
        if (del.parentNode && /PrChange/.test(del.parentNode.localName || '')) continue;
        /* Usunięty tekst jest w w:delText */
        var dtNodes = del.getElementsByTagNameNS('*', 'delText');
        var text = '';
        for (var j = 0; j < dtNodes.length; j++) text += dtNodes[j].textContent || '';
        text = text.trim();
        if (!text) continue;
        result.tracked.push({
          type:   'del',
          author: attr(del, 'author') || 'nieznany',
          date:   fmtDate(attr(del, 'date')),
          text:   text
        });
      }

      /* Ukryty tekst: w:rPr zawiera w:vanish */
      var runs = docXml.getElementsByTagNameNS('*', 'r');
      for (var i = 0; i < runs.length; i++) {
        var run = runs[i];
        var rPr = run.getElementsByTagNameNS('*', 'rPr')[0];
        if (!rPr) continue;
        var vanish = rPr.getElementsByTagNameNS('*', 'vanish')[0];
        if (!vanish) continue;
        /* Sprawdź, czy vanish nie jest wyłączony (val="0") */
        var val = attr(vanish, 'val');
        if (val === '0' || val === 'false') continue;
        var tNodes = run.getElementsByTagNameNS('*', 't');
        var text = '';
        for (var j = 0; j < tNodes.length; j++) text += tNodes[j].textContent || '';
        text = text.trim();
        if (text) result.hiddenText.push(text);
      }

      /* Pola formularzy (legacy w:fldChar / w:instrText) */
      var instrNodes = docXml.getElementsByTagNameNS('*', 'instrText');
      for (var i = 0; i < instrNodes.length; i++) {
        var instr = instrNodes[i].textContent.trim();
        if (instr) result.formFields.push(instr);
      }

    } catch (e) { /* ignoruj */ }
  }

  return result;
}

/* ─────────────────────────────────────────────
   PDF — parser (pdf.js)
───────────────────────────────────────────── */

async function parsePdf(buf) {
  var result = {
    format: 'PDF',
    supported: true,
    error: null,
    props: {},
    annotations: [],   // { page, type, author, date, text }
    formFields: [],    // { name, value }
    layers: [],        // nazwy warstw opcjonalnych
    invisibleText: []  // fragmenty tekstu z renderMode 3 (invisible)
  };

  if (typeof pdfjsLib === 'undefined') {
    result.supported = false;
    result.error = 'Biblioteka pdf.js nie załadowała się. Sprawdź połączenie z internetem.';
    return result;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  var pdf;
  try {
    var loadTask = pdfjsLib.getDocument({ data: new Uint8Array(buf), password: '' });
    pdf = await loadTask.promise;
  } catch (e) {
    result.supported = false;
    if (e && e.name === 'PasswordException') {
      result.error = 'Plik jest zabezpieczony hasłem — nie można go odczytać.';
    } else {
      result.error = 'Nie udało się otworzyć pliku PDF. Może być uszkodzony.';
    }
    return result;
  }

  /* ── Metadane ── */
  try {
    var meta = await pdf.getMetadata();
    var info = (meta && meta.info) ? meta.info : {};
    if (info.Author)       result.props['Autor']            = info.Author;
    if (info.Creator)      result.props['Aplikacja twórcy'] = info.Creator;
    if (info.Producer)     result.props['Producent PDF']    = info.Producer;
    if (info.CreationDate) result.props['Data utworzenia']  = fmtDate(info.CreationDate);
    if (info.ModDate)      result.props['Data modyfikacji'] = fmtDate(info.ModDate);
    if (info.Title)        result.props['Tytuł']            = info.Title;
    if (info.Subject)      result.props['Temat']            = info.Subject;
    if (info.Keywords)     result.props['Słowa kluczowe']   = info.Keywords;
  } catch (e) { /* ignoruj */ }

  /* ── Warstwy opcjonalne (Optional Content Groups) ── */
  try {
    var ocg = await pdf.getOptionalContentConfig();
    if (ocg) {
      var groups = ocg.getGroups ? ocg.getGroups() : null;
      if (groups) {
        Object.keys(groups).forEach(function (id) {
          var g = groups[id];
          result.layers.push({
            name:    g.name || id,
            visible: g.visible !== false
          });
        });
      }
    }
  } catch (e) { /* ignoruj */ }

  /* ── Adnotacje i pola formularzy (strona po stronie) ── */
  var numPages = pdf.numPages;
  for (var p = 1; p <= numPages; p++) {
    var page;
    try { page = await pdf.getPage(p); } catch (e) { continue; }

    /* Adnotacje */
    try {
      var annots = await page.getAnnotations();
      annots.forEach(function (a) {
        var subtype = a.subtype || '';

        /* Pola formularzy */
        if (subtype === 'Widget') {
          var val = '';
          if (typeof a.fieldValue === 'string') val = a.fieldValue;
          else if (Array.isArray(a.fieldValue)) val = a.fieldValue.join(', ');
          result.formFields.push({
            name:  a.fieldName || '(bez nazwy)',
            value: val
          });
          return;
        }

        /* Adnotacje tekstowe / komentarze */
        var text = (a.contents || '').trim();
        var title = (a.title || '').trim();
        if (!text && !title) return;

        result.annotations.push({
          page:   p,
          type:   subtype || 'Adnotacja',
          author: title || 'nieznany',
          date:   fmtDate(a.modificationDate || a.creationDate || ''),
          text:   text || '(brak treści)'
        });
      });
    } catch (e) { /* ignoruj */ }

    /* Niewidoczny tekst (renderMode 3 = invisible) */
    try {
      var textContent = await page.getTextContent({ includeMarkedContent: false });
      textContent.items.forEach(function (item) {
        /* pdf.js nie eksponuje renderMode bezpośrednio w getTextContent,
           ale możemy sprawdzić transform — tekst z zerową skalą jest niewidoczny */
        if (!item.str || !item.str.trim()) return;
        var t = item.transform;
        /* Macierz [a,b,c,d,e,f] — jeśli a i d są bliskie 0, tekst jest niewidoczny */
        if (t && Math.abs(t[0]) < 0.01 && Math.abs(t[3]) < 0.01) {
          result.invisibleText.push({ page: p, text: item.str.trim() });
        }
      });
    } catch (e) { /* ignoruj */ }
  }

  return result;
}

/* ─────────────────────────────────────────────
   Budowanie karty wynikowej
───────────────────────────────────────────── */

function buildCard(file, res) {
  var ext = (file.name.split('.').pop() || '').toLowerCase();

  /* ── Ikona pliku ── */
  var iconClass = ext === 'pdf' ? 'pdf' : 'docx';
  var iconGlyph = ext === 'pdf' ? 'ti-file-type-pdf' : 'ti-file-type-docx';

  /* ── Nagłówek karty ── */
  var head = '<div class="fc-head">'
    + '<div class="fc-icon ' + iconClass + '"><span class="ti ' + iconGlyph + '" aria-hidden="true"></span></div>'
    + '<div class="fc-meta">'
    + '<p class="fc-name">' + esc(file.name) + '</p>'
    + '<p class="fc-sub">' + res.format + ' · ' + kb(file.size) + '</p>'
    + '</div></div>';

  /* ── Błąd / nieobsługiwany ── */
  if (!res.supported) {
    return head
      + '<div class="verdict unknown"><span class="ti ti-alert-circle"></span>'
      + esc(res.error || 'Nie udało się odczytać pliku.') + '</div>';
  }

  /* ── Zlicz znaleziska ── */
  var propsCount  = Object.keys(res.props || {}).length;
  var hiddenCount = 0;
  if (res.comments)      hiddenCount += res.comments.length;
  if (res.tracked)       hiddenCount += res.tracked.length;
  if (res.hiddenText)    hiddenCount += res.hiddenText.length;
  if (res.annotations)   hiddenCount += res.annotations.length;
  if (res.formFields)    hiddenCount += res.formFields.length;
  if (res.layers)        hiddenCount += res.layers.length;
  if (res.invisibleText) hiddenCount += res.invisibleText.length;
  var totalFindings = hiddenCount + propsCount;

  /* ── Werdykt ── */
  var verdict;
  if (totalFindings === 0) {
    /* Stan 1: absolutnie nic — plik czysty */
    verdict = '<div class="verdict clean"><span class="ti ti-circle-check"></span>'
      + 'Nie znaleziono żadnych ukrytych treści ani właściwości dokumentu. Plik jest czysty.</div>';
  } else if (hiddenCount > 0) {
    /* Stan 3: komentarze, śledzone zmiany lub ukryty tekst */
    var n = hiddenCount;
    var label = n === 1 ? 'znalezisko' : n < 5 ? 'znaleziska' : 'znalezisk';
    verdict = '<div class="verdict dirty"><span class="ti ti-eye-exclamation"></span>'
      + 'Znaleziono ' + n + ' ' + label + ' — treści niewidoczne w normalnym podglądzie.'
      + (propsCount ? ' Plik niesie też ' + propsCount + ' '
          + (propsCount === 1 ? 'zapis' : propsCount < 5 ? 'zapisy' : 'zapisów')
          + ' o swoim pochodzeniu.' : '')
      + '</div>';
  } else {
    /* Stan 2: tylko właściwości dokumentu, brak ukrytych treści */
    var n = propsCount;
    var label = n === 1 ? 'zapis' : n < 5 ? 'zapisy' : 'zapisów';
    verdict = '<div class="verdict unknown"><span class="ti ti-info-circle"></span>'
      + 'Brak komentarzy i śledzonych zmian, ale plik niesie ' + n + ' ' + label
      + ' o swoim pochodzeniu — autorze, dacie i aplikacji, w której powstał.</div>';
  }

  /* ── Sekcje znalezisk ── */
  var sections = '';

  /* Właściwości dokumentu */
  var props = res.props || {};
  if (Object.keys(props).length) {
    var rows = Object.keys(props).map(function (k) {
      var alarm = /Autor|modyfikacja|Firma/i.test(k);
      return '<div class="frow"><div class="fkey">' + esc(k) + '</div>'
        + '<div class="fval' + (alarm ? ' alarm' : '') + '">' + esc(props[k]) + '</div></div>';
    }).join('');
    sections += fgroup('ti-id', 'Właściwości dokumentu', rows, Object.keys(props).length);
  }

  /* Komentarze (DOCX) */
  if (res.comments && res.comments.length) {
    var items = res.comments.map(function (c) {
      return findingItem('comment', 'Komentarz', c.author, c.date, c.text, false);
    }).join('');
    sections += fgroup('ti-message-circle', 'Komentarze', items, res.comments.length);
  }

  /* Śledzone zmiany (DOCX) */
  if (res.tracked && res.tracked.length) {
    var items = res.tracked.map(function (t) {
      var label = t.type === 'ins' ? 'Wstawienie' : 'Usunięcie';
      return findingItem(t.type, label, t.author, t.date, t.text, t.type === 'del');
    }).join('');
    sections += fgroup('ti-git-branch', 'Śledzone zmiany', items, res.tracked.length);
  }

  /* Ukryty tekst (DOCX) */
  if (res.hiddenText && res.hiddenText.length) {
    var items = res.hiddenText.map(function (t) {
      return '<div class="hidden-text-block">' + esc(t) + '</div>';
    }).join('');
    sections += fgroup('ti-eye-off', 'Ukryty tekst', items, res.hiddenText.length);
  }

  /* Adnotacje (PDF) */
  if (res.annotations && res.annotations.length) {
    var items = res.annotations.map(function (a) {
      var label = esc(a.type) + ' · str. ' + a.page;
      return findingItem('comment', label, a.author, a.date, a.text, false);
    }).join('');
    sections += fgroup('ti-message-dots', 'Adnotacje i notatki', items, res.annotations.length);
  }

  /* Pola formularzy (PDF) */
  if (res.formFields && res.formFields.length) {
    var rows = res.formFields.map(function (f) {
      var name  = typeof f === 'object' ? f.name  : f;
      var value = typeof f === 'object' ? f.value : '';
      return '<div class="frow"><div class="fkey">' + esc(name) + '</div>'
        + '<div class="fval">' + (value ? esc(value) : '<span style="color:var(--muted-foreground)">(puste)</span>') + '</div></div>';
    }).join('');
    sections += fgroup('ti-forms', 'Pola formularzy', rows, res.formFields.length);
  }

  /* Warstwy opcjonalne (PDF) */
  if (res.layers && res.layers.length) {
    var rows = res.layers.map(function (l) {
      return '<div class="frow"><div class="fkey">' + esc(l.name) + '</div>'
        + '<div class="fval">' + (l.visible ? 'widoczna' : '<span style="color:var(--danger)">ukryta</span>') + '</div></div>';
    }).join('');
    sections += fgroup('ti-stack-2', 'Warstwy opcjonalne', rows, res.layers.length);
  }

  /* Niewidoczny tekst (PDF) */
  if (res.invisibleText && res.invisibleText.length) {
    var items = res.invisibleText.map(function (t) {
      return '<div class="hidden-text-block">str. ' + t.page + ': ' + esc(t.text) + '</div>';
    }).join('');
    sections += fgroup('ti-eye-off', 'Tekst niewidoczny', items, res.invisibleText.length);
  }

  return head + verdict + (sections ? '<div class="findings">' + sections + '</div>' : '');
}

/* Buduje sekcję grupy znalezisk */
function fgroup(icon, title, content, count) {
  return '<div class="fgroup">'
    + '<div class="fgroup-head">'
    + '<span class="ti ' + icon + '" aria-hidden="true"></span>'
    + esc(title)
    + '<span class="fgroup-count">' + count + '</span>'
    + '</div>'
    + content
    + '</div>';
}

/* Buduje kartę pojedynczego znaleziska (komentarz / śledzona zmiana) */
function findingItem(type, label, author, date, text, isDeleted) {
  return '<div class="finding-item">'
    + '<div class="fi-meta">'
    + '<span class="fi-badge ' + esc(type) + '">' + esc(label) + '</span>'
    + '<span class="fi-author">' + esc(author) + '</span>'
    + (date ? '<span class="fi-date">' + esc(date) + '</span>' : '')
    + '</div>'
    + '<div class="fi-body' + (isDeleted ? ' deleted' : '') + '">' + esc(text) + '</div>'
    + '</div>';
}

/* ─────────────────────────────────────────────
   Obsługa plików
───────────────────────────────────────────── */

var resultsEl = document.getElementById('results');
var dropzone  = document.getElementById('dropzone');
var picker    = document.getElementById('picker');

async function handle(file) {
  var ext = (file.name.split('.').pop() || '').toLowerCase();

  /* Placeholder z spinnerem */
  var placeholder = document.createElement('div');
  placeholder.className = 'file-card';
  placeholder.innerHTML =
    '<div class="fc-head">'
    + '<div class="fc-icon ' + (ext === 'pdf' ? 'pdf' : 'docx') + '">'
    + '<span class="ti ' + (ext === 'pdf' ? 'ti-file-type-pdf' : 'ti-file-type-docx') + '" aria-hidden="true"></span>'
    + '</div>'
    + '<div class="fc-meta">'
    + '<p class="fc-name">' + esc(file.name) + '</p>'
    + '<p class="fc-sub">Analizuję…<span class="fc-spinner"></span></p>'
    + '</div></div>';
  resultsEl.appendChild(placeholder);

  var buf, res;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    placeholder.innerHTML =
      '<div class="verdict unknown" style="border-top:0">'
      + '<span class="ti ti-alert-circle"></span>'
      + 'Nie udało się odczytać pliku ' + esc(file.name) + '.</div>';
    return;
  }

  try {
    if (ext === 'docx') {
      res = await parseDocx(buf);
    } else if (ext === 'pdf') {
      res = await parsePdf(buf);
    } else {
      res = {
        format: ext.toUpperCase() || 'nieznany',
        supported: false,
        error: 'Nieobsługiwany format. Ten moduł obsługuje DOCX i PDF.'
      };
    }
  } catch (e) {
    res = {
      format: ext.toUpperCase() || 'nieznany',
      supported: false,
      error: 'Wystąpił nieoczekiwany błąd podczas analizy pliku.'
    };
  }

  var card = document.createElement('div');
  card.className = 'file-card';
  card.innerHTML = buildCard(file, res);
  placeholder.replaceWith(card);
}

function accept(list) {
  Array.prototype.forEach.call(list, function (f) {
    handle(f).catch(function (e) {
      var el = document.createElement('div');
      el.className = 'file-card';
      el.innerHTML =
        '<div class="verdict unknown" style="border-top:0">'
        + '<span class="ti ti-alert-circle"></span>'
        + 'Nie udało się przetworzyć pliku ' + esc(f.name) + '.</div>';
      resultsEl.appendChild(el);
    });
  });
}

/* ─────────────────────────────────────────────
   Zdarzenia UI
───────────────────────────────────────────── */

dropzone.addEventListener('click', function () { picker.click(); });
dropzone.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
});
picker.addEventListener('change', function (e) { accept(e.target.files); e.target.value = ''; });
dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('over'); });
dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('over'); });
dropzone.addEventListener('drop', function (e) {
  e.preventDefault();
  dropzone.classList.remove('over');
  accept(e.dataTransfer.files);
});

})();
