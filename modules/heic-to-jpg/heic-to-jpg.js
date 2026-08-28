/**
 * heic-to-jpg.js – Konwersja HEIC/HEIF na JPG/PNG/WebP
 * heic2any (CDN) konwertuje blob → blob.
 * Wiele plików → ZIP. Wszystko lokalnie.
 */
(function () {
  'use strict';

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var files     = [];
  var idCounter = 0;
  var targetFmt = 'image/jpeg';
  var targetExt = 'jpg';
  var quality   = 0.92;

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var wsCount      = document.getElementById('wsCount');
  var imgGrid      = document.getElementById('imgGrid');
  var btnAddMore   = document.getElementById('btnAddMore');
  var btnClear     = document.getElementById('btnClear');
  var btnConvert   = document.getElementById('btnConvert');
  var convertInfo  = document.getElementById('convertInfo');
  var qualityRange = document.getElementById('qualityRange');
  var qualityVal   = document.getElementById('qualityVal');
  var qualityWrap  = document.getElementById('qualityWrap');
  var imgCardTpl   = document.getElementById('imgCardTpl');
  var errorsList   = null;

  /* ── Format ───────────────────────────────────────────────────────── */
  document.querySelectorAll('.fmt-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.fmt-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      targetFmt = btn.dataset.fmt;
      targetExt = btn.dataset.ext;
      qualityWrap.style.display = (targetFmt === 'image/png') ? 'none' : 'flex';
      updateWorkspace();
    });
  });

  qualityRange.addEventListener('input', function () {
    quality = parseInt(qualityRange.value, 10) / 100;
    qualityVal.textContent = qualityRange.value;
  });

  /* ── Dropzone ─────────────────────────────────────────────────────── */
  dropzone.addEventListener('click', function () { picker.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
  });
  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault(); dropzone.classList.add('over');
  });
  dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('over'); });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault(); dropzone.classList.remove('over');
    handleFiles(Array.from(e.dataTransfer.files));
  });
  picker.addEventListener('change', function () {
    handleFiles(Array.from(picker.files)); picker.value = '';
  });

  btnAddMore.addEventListener('click', function () { picker.click(); });
  btnClear.addEventListener('click', clearAll);
  btnConvert.addEventListener('click', convertAll);

  /* ── Obsługa plików ───────────────────────────────────────────────── */
  function handleFiles(fileList) {
    fileList.forEach(function (f) {
      var name = f.name.toLowerCase();
      var isHeic = f.type === 'image/heic' || f.type === 'image/heif' ||
                   name.endsWith('.heic') || name.endsWith('.heif');
      if (!isHeic) {
        showError(f.name, 'Obsługiwane są tylko pliki .heic i .heif.');
        return;
      }
      addFile(f);
    });
  }

  function addFile(file) {
    var entry = {
      id:            'h' + (++idCounter),
      file:          file,
      fileName:      file.name,
      origSize:      file.size,
      convertedBlob: null,
      el:            null
    };
    files.push(entry);
    var card = createCard(entry);
    entry.el = card;
    imgGrid.appendChild(card);
    updateWorkspace();
    convertOnLoad(entry);
  }

  /* ── Konwersja przy wrzuceniu ─────────────────────────────────────── */
  function convertOnLoad(entry) {
    var heic2any = window.heic2any;
    if (!heic2any) return;
    setCardStatus(entry, 'Konwertuję…', null);
    var q = (targetFmt === 'image/png') ? undefined : quality;
    var opts = { blob: entry.file, toType: targetFmt };
    if (q !== undefined) opts.quality = q;
    heic2any(opts).then(function (blob) {
      entry.convertedBlob = blob;
      showCardPreview(entry, blob);
      setCardStatus(entry, 'Gotowe', 'var(--primary)');
      updateSaveBtn();
    }).catch(function () {
      setCardStatus(entry, 'Błąd konwersji', 'var(--danger)');
    });
  }

  function updateSaveBtn() {
    var ready = files.filter(function (e) { return !!e.convertedBlob; }).length;
    btnConvert.disabled = (ready === 0);
    if (ready > 0) {
      convertInfo.textContent = ready + ' ' +
        pluralStr(ready, 'plik gotowy', 'pliki gotowe', 'plików gotowych') + ' do pobrania';
    }
  }

  function showCardPreview(entry, blob) {
    if (!entry.el) return;
    var placeholder = entry.el.querySelector('.ic-placeholder');
    var preview     = entry.el.querySelector('.ic-preview');
    if (!preview) return;
    preview.src    = URL.createObjectURL(blob);
    preview.hidden = false;
    if (placeholder) placeholder.style.display = 'none';
  }

  /* ── Karta ────────────────────────────────────────────────────────── */
  function createCard(entry) {
    var frag = imgCardTpl.content.cloneNode(true);
    var card = frag.querySelector('.img-card');
    card.dataset.id = entry.id;

    var nameEl   = card.querySelector('.ic-name');
    var statusEl = card.querySelector('.ic-status');
    var delBtn   = card.querySelector('.ic-del');

    nameEl.textContent   = entry.fileName;
    statusEl.textContent = formatBytes(entry.origSize);

    delBtn.addEventListener('click', function () { removeFile(entry.id); });
    return card;
  }

  function setCardStatus(entry, text, color) {
    if (!entry.el) return;
    var statusEl = entry.el.querySelector('.ic-status');
    statusEl.textContent = text;
    if (color) statusEl.style.color = color;
    if (color === 'var(--primary)') entry.el.classList.add('done');
  }

  function removeFile(id) {
    var idx = indexById(id);
    if (idx === -1) return;
    if (files[idx].el) files[idx].el.remove();
    files.splice(idx, 1);
    updateWorkspace();
  }

  function clearAll() {
    files = [];
    imgGrid.innerHTML = '';
    if (errorsList) errorsList.innerHTML = '';
    convertInfo.textContent = '';
    updateWorkspace();
  }

  function indexById(id) {
    for (var i = 0; i < files.length; i++) { if (files[i].id === id) return i; }
    return -1;
  }

  function updateWorkspace() {
    if (files.length === 0) { workspace.hidden = true; return; }
    workspace.hidden = false;
    wsCount.textContent = files.length + ' ' +
      pluralStr(files.length, 'plik', 'pliki', 'plików') + ' HEIC';
  }

  /* ── Konwersja ────────────────────────────────────────────────────── */
  function convertAll() {
    var results = files
      .filter(function (e) { return !!e.convertedBlob; })
      .map(function (e) {
        return { blob: e.convertedBlob, name: stripExt(e.fileName) + '.' + targetExt };
      });
    if (results.length === 0) return;
    btnConvert.disabled = true;
    convertInfo.textContent = 'Pobieram…';
    finish(results);
  }

  function finish(results) {
    if (results.length === 0) {
      convertInfo.textContent = 'Brak wyników do pobrania.';
      btnConvert.disabled = false;
      return;
    }

    if (results.length === 1) {
      downloadBlob(results[0].blob, results[0].name);
      convertInfo.textContent = 'Pobrano · ' + results[0].name;
      btnConvert.disabled = false;
      return;
    }

    convertInfo.textContent = 'Pakuję ZIP…';
    var JSZip = window.JSZip;
    if (!JSZip) {
      results.forEach(function (r) { downloadBlob(r.blob, r.name); });
      convertInfo.textContent = 'Pobrano ' + results.length + ' pliki.';
      btnConvert.disabled = false;
      return;
    }

    var zip = new JSZip();
    var folder = zip.folder('zdjecia-' + targetExt);
    results.forEach(function (r) { folder.file(r.name, r.blob); });
    zip.generateAsync({ type: 'blob' }).then(function (zipBlob) {
      downloadBlob(zipBlob, 'zdjecia-' + targetExt + '.zip');
      convertInfo.textContent = 'Pobrano ZIP · ' + results.length + ' ' +
        pluralStr(results.length, 'plik', 'pliki', 'plików');
      btnConvert.disabled = false;
    });
  }

  /* ── Pobieranie ───────────────────────────────────────────────────── */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  /* ── Błędy ────────────────────────────────────────────────────────── */
  function ensureErrorsList() {
    if (!errorsList) {
      errorsList = document.createElement('div');
      errorsList.className = 'errors-list';
      dropzone.parentNode.insertBefore(errorsList, dropzone.nextSibling);
    }
    return errorsList;
  }

  function showError(fileName, message) {
    var list = ensureErrorsList();
    var item = document.createElement('div');
    item.className = 'file-error';
    item.setAttribute('role', 'alert');
    item.innerHTML =
      '<span class="ti ti-alert-circle" aria-hidden="true"></span>' +
      '<div class="file-error-body">' +
        '<div class="file-error-name">' + escHtml(fileName) + '</div>' +
        '<div class="file-error-msg">'  + escHtml(message)  + '</div>' +
      '</div>' +
      '<button class="file-error-close" aria-label="Zamknij">' +
        '<span class="ti ti-x" aria-hidden="true"></span></button>';
    item.querySelector('.file-error-close').addEventListener('click', function () { item.remove(); });
    list.appendChild(item);
  }

  /* ── Pomocnicze ───────────────────────────────────────────────────── */
  function stripExt(name) {
    var dot = name.lastIndexOf('.');
    return dot !== -1 ? name.substring(0, dot) : name;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function pluralStr(n, one, few, many) {
    if (n === 1) return one; if (n >= 2 && n <= 4) return few; return many;
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
