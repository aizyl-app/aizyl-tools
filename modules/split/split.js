/**
 * split.js — Podział pliku PDF
 * Zaznacz strony, pobierz jako jeden PDF lub ZIP z osobnymi stronami.
 * Żadne dane użytkownika nie opuszczają przeglądarki.
 */
(function () {
  'use strict';

  /* ── Konfiguracja pdf.js ──────────────────────────────────────────── */
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ── Stan aplikacji ───────────────────────────────────────────────── */
  /**
   * @typedef {{ id: string, pageIndex: number, pdfDoc: object,
   *             rotation: number, selected: boolean, el: HTMLElement|null }} PageEntry
   */
  /** @type {PageEntry[]} */
  var pages      = [];
  var fileName   = '';
  var idCounter  = 0;
  var errorsList = null;

  /* ── Elementy DOM ─────────────────────────────────────────────────── */
  var dropzone       = document.getElementById('dropzone');
  var picker         = document.getElementById('picker');
  var loadProgress   = document.getElementById('loadProgress');
  var lpFill         = document.getElementById('lpFill');
  var lpLabel        = document.getElementById('lpLabel');
  var workspace      = document.getElementById('workspace');
  var wsCount        = document.getElementById('wsCount');
  var pageGrid       = document.getElementById('pageGrid');
  var btnSelectAll   = document.getElementById('btnSelectAll');
  var btnSelectNone  = document.getElementById('btnSelectNone');
  var btnNewFile     = document.getElementById('btnNewFile');
  var splitBarInfo   = document.getElementById('splitBarInfo');
  var btnDownloadOne = document.getElementById('btnDownloadOne');
  var btnDownloadZip = document.getElementById('btnDownloadZip');
  var splitStatus    = document.getElementById('splitStatus');
  var pageTpl        = document.getElementById('pageTpl');

  /* ── Obsługa dropzone ─────────────────────────────────────────────── */
  dropzone.addEventListener('click', function () { picker.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
  });
  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault(); dropzone.classList.add('over');
  });
  dropzone.addEventListener('dragleave', function () {
    dropzone.classList.remove('over');
  });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault(); dropzone.classList.remove('over');
    handleFiles(Array.from(e.dataTransfer.files));
  });
  picker.addEventListener('change', function () {
    handleFiles(Array.from(picker.files));
    picker.value = '';
  });

  btnSelectAll.addEventListener('click',   function () { setAllSelected(true); });
  btnSelectNone.addEventListener('click',  function () { setAllSelected(false); });
  btnNewFile.addEventListener('click',     function () { picker.click(); });
  btnDownloadOne.addEventListener('click', downloadAsPdf);
  btnDownloadZip.addEventListener('click', downloadAsZip);

  /* ── Obsługa pliku ────────────────────────────────────────────────── */
  function handleFiles(files) {
    var pdf = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].type === 'application/pdf' || files[i].name.toLowerCase().endsWith('.pdf')) {
        pdf = files[i];
        break;
      }
    }
    if (!pdf) {
      showError(files[0] ? files[0].name : 'plik', 'Obsługiwane są wyłącznie pliki .pdf.');
      return;
    }
    loadFile(pdf);
  }

  function loadFile(file) {
    fileName = file.name;
    clearAll();
    showProgress(true);
    setProgress(0, 'Otwieram plik…');

    var reader = new FileReader();
    reader.onload = function (e) {
      var data = new Uint8Array(e.target.result);
      pdfjsLib.getDocument({ data: data }).promise.then(function (pdfDoc) {
        var total = pdfDoc.numPages;
        setProgress(0.1, 'Wczytuję strony…');

        var newEntries = [];
        for (var p = 1; p <= total; p++) {
          var entry = {
            id:        'p' + (++idCounter),
            pageIndex: p - 1,
            pdfDoc:    pdfDoc,
            rotation:  0,
            selected:  true,
            el:        null
          };
          newEntries.push(entry);
          pages.push(entry);
          var card = createCard(entry);
          entry.el = card;
          pageGrid.appendChild(card);
        }

        showProgress(false);
        updateWorkspace();
        renderThumbnailsLazy(newEntries, 0, null);
      }, function (err) {
        showProgress(false);
        showError(file.name, classifyPdfError(err));
      });
    };
    reader.onerror = function () {
      showProgress(false);
      showError(file.name, 'Nie udało się odczytać pliku. Sprawdź, czy plik nie jest uszkodzony.');
    };
    reader.readAsArrayBuffer(file);
  }

  /* ── Lazy rendering miniatur ──────────────────────────────────────── */
  function renderThumbnailsLazy(entries, startIdx, onAllDone) {
    var BATCH = 4;
    var end   = Math.min(startIdx + BATCH, entries.length);
    var promises = [];
    for (var i = startIdx; i < end; i++) {
      promises.push(renderThumbnail(entries[i]));
    }
    Promise.all(promises).then(function () {
      if (end < entries.length) {
        setTimeout(function () { renderThumbnailsLazy(entries, end, onAllDone); }, 0);
      } else {
        if (onAllDone) onAllDone();
      }
    });
  }

  function renderThumbnail(entry) {
    if (!entry.el) return Promise.resolve();
    var canvas  = entry.el.querySelector('.pc-canvas');
    var spinner = entry.el.querySelector('.pc-spinner');

    return entry.pdfDoc.getPage(entry.pageIndex + 1).then(function (page) {
      var viewport = page.getViewport({ scale: 1, rotation: entry.rotation });
      var scale    = 148 / viewport.width;
      var vp       = page.getViewport({ scale: scale, rotation: entry.rotation });
      canvas.width  = vp.width;
      canvas.height = vp.height;
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }).then(function () {
      if (spinner) spinner.classList.add('hidden');
    }).catch(function () {
      if (spinner) spinner.classList.add('hidden');
    });
  }

  /* ── Tworzenie karty ──────────────────────────────────────────────── */
  function createCard(entry) {
    var frag = pageTpl.content.cloneNode(true);
    var card = frag.querySelector('.page-card');
    card.dataset.id = entry.id;
    card.setAttribute('tabindex', '0');

    var numEl  = card.querySelector('.pc-num');
    var btnRot = card.querySelector('.pc-rotate');

    numEl.textContent = 'Str. ' + (pages.indexOf(entry) + 1);

    /* Toggle zaznaczenia kliknięciem karty */
    card.addEventListener('click', function (e) {
      if (e.target.closest('.pc-btn')) return;
      entry.selected = !entry.selected;
      updateCardState(card, entry);
      updateWorkspace();
    });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        entry.selected = !entry.selected;
        updateCardState(card, entry);
        updateWorkspace();
      }
    });

    btnRot.addEventListener('click', function (e) {
      e.stopPropagation();
      entry.rotation = (entry.rotation + 90) % 360;
      renderThumbnail(entry);
    });

    updateCardState(card, entry);
    return card;
  }

  function updateCardState(card, entry) {
    card.classList.toggle('selected',   entry.selected);
    card.classList.toggle('deselected', !entry.selected);
    card.setAttribute('aria-pressed', String(entry.selected));
  }

  /* ── Zaznaczanie wszystkich ───────────────────────────────────────── */
  function setAllSelected(val) {
    pages.forEach(function (entry) {
      entry.selected = val;
      if (entry.el) updateCardState(entry.el, entry);
    });
    updateWorkspace();
  }

  /* ── Aktualizacja UI ──────────────────────────────────────────────── */
  function updateWorkspace() {
    if (pages.length === 0) { workspace.hidden = true; return; }
    workspace.hidden = false;

    var total    = pages.length;
    var selected = pages.filter(function (p) { return p.selected; }).length;

    wsCount.textContent = total + ' ' + pluralStr(total, 'strona', 'strony', 'stron') + ' · ' + fileName;

    splitBarInfo.textContent =
      selected + ' z ' + total + ' zaznaczone';

    pages.forEach(function (entry, idx) {
      if (entry.el) {
        var numEl = entry.el.querySelector('.pc-num');
        if (numEl) numEl.textContent = 'Str. ' + (idx + 1);
      }
    });

    var hasSelection = selected > 0;
    btnDownloadOne.disabled = !hasSelection;
    btnDownloadZip.disabled = !hasSelection;
  }

  /* ── Postęp ───────────────────────────────────────────────────────── */
  function showProgress(visible) { loadProgress.hidden = !visible; }
  function setProgress(ratio, label) {
    lpFill.style.width  = Math.round(ratio * 100) + '%';
    lpLabel.textContent = label;
  }

  /* ── Czyszczenie ──────────────────────────────────────────────────── */
  function clearAll() {
    pages      = [];
    idCounter  = 0;
    pageGrid.innerHTML     = '';
    splitStatus.textContent = '';
    if (errorsList) errorsList.innerHTML = '';
  }

  /* ── Pobieranie — jeden PDF ───────────────────────────────────────── */
  function downloadAsPdf() {
    var selected = pages.filter(function (p) { return p.selected; });
    if (selected.length === 0) return;

    setDownloadBusy(true);
    splitStatus.textContent = 'Tworzę plik…';

    var PDFLib = window.PDFLib;
    if (!PDFLib) {
      splitStatus.textContent = 'Błąd: biblioteka pdf-lib niedostępna.';
      setDownloadBusy(false);
      return;
    }

    PDFLib.PDFDocument.create().then(function (outDoc) {
      return selected.reduce(function (chain, entry) {
        return chain.then(function () { return copyPage(outDoc, entry); });
      }, Promise.resolve()).then(function () { return outDoc.save(); });
    }).then(function (bytes) {
      var baseName = fileName.replace(/\.pdf$/i, '');
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), baseName + '-wyodrebnione.pdf');
      splitStatus.textContent = 'Pobrano · ' + selected.length + ' ' +
        pluralStr(selected.length, 'strona', 'strony', 'stron');
    }).catch(function (err) {
      splitStatus.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany błąd');
    }).then(function () { setDownloadBusy(false); });
  }

  /* ── Pobieranie — ZIP ─────────────────────────────────────────────── */
  function downloadAsZip() {
    var selected = pages.filter(function (p) { return p.selected; });
    if (selected.length === 0) return;

    if (typeof JSZip === 'undefined') {
      splitStatus.textContent = 'Błąd: biblioteka JSZip niedostępna.';
      return;
    }

    setDownloadBusy(true);
    splitStatus.textContent = 'Pakuję strony…';

    var PDFLib   = window.PDFLib;
    var zip      = new JSZip();
    var baseName = fileName.replace(/\.pdf$/i, '');
    var total    = selected.length;
    var done     = 0;

    var chain = selected.reduce(function (prev, entry) {
      return prev.then(function () {
        return PDFLib.PDFDocument.create().then(function (singleDoc) {
          return copyPage(singleDoc, entry).then(function () { return singleDoc.save(); });
        }).then(function (bytes) {
          var pageNum = String(entry.pageIndex + 1).padStart(3, '0');
          zip.file(baseName + '-strona-' + pageNum + '.pdf', bytes);
          done++;
          splitStatus.textContent = 'Pakuję… ' + done + ' / ' + total;
        });
      });
    }, Promise.resolve());

    chain.then(function () {
      splitStatus.textContent = 'Generuję ZIP…';
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) {
      downloadBlob(blob, baseName + '-strony.zip');
      splitStatus.textContent = 'Pobrano · ' + total + ' ' +
        pluralStr(total, 'strona', 'strony', 'stron');
    }).catch(function (err) {
      splitStatus.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany błąd');
    }).then(function () { setDownloadBusy(false); });
  }

  /* ── Kopiowanie strony ────────────────────────────────────────────── */
  function copyPage(outDoc, entry) {
    var PDFLib = window.PDFLib;
    return entry.pdfDoc.getData().then(function (data) {
      return PDFLib.PDFDocument.load(data, { ignoreEncryption: false });
    }).then(function (srcDoc) {
      return outDoc.copyPages(srcDoc, [entry.pageIndex]);
    }).then(function (copiedPages) {
      var page = copiedPages[0];
      if (entry.rotation !== 0) {
        var current = page.getRotation().angle;
        page.setRotation(PDFLib.degrees((current + entry.rotation) % 360));
      }
      outDoc.addPage(page);
    });
  }

  /* ── Pomocnicze ───────────────────────────────────────────────────── */
  function setDownloadBusy(busy) {
    btnDownloadOne.disabled = busy;
    btnDownloadZip.disabled = busy;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function ensureErrorsList() {
    if (!errorsList) {
      errorsList = document.createElement('div');
      errorsList.className = 'errors-list';
      dropzone.parentNode.insertBefore(errorsList, dropzone.nextSibling);
    }
    return errorsList;
  }

  function showError(name, message) {
    var list = ensureErrorsList();
    var item = document.createElement('div');
    item.className = 'file-error';
    item.setAttribute('role', 'alert');
    item.innerHTML =
      '<span class="ti ti-alert-circle" aria-hidden="true"></span>' +
      '<div class="file-error-body">' +
        '<div class="file-error-name">' + escHtml(name)    + '</div>' +
        '<div class="file-error-msg">'  + escHtml(message) + '</div>' +
      '</div>' +
      '<button class="file-error-close" aria-label="Zamknij">' +
        '<span class="ti ti-x" aria-hidden="true"></span>' +
      '</button>';
    item.querySelector('.file-error-close').addEventListener('click', function () { item.remove(); });
    list.appendChild(item);
  }

  function classifyPdfError(err) {
    var msg = (err && err.message) ? err.message.toLowerCase() : '';
    if (msg.indexOf('password') !== -1 || msg.indexOf('encrypted') !== -1)
      return 'Plik jest zabezpieczony hasłem. Usuń ochronę przed podziałem.';
    if (msg.indexOf('invalid pdf') !== -1 || msg.indexOf('missing pdf') !== -1)
      return 'Plik jest uszkodzony lub nie jest prawidłowym dokumentem PDF.';
    return 'Nie udało się otworzyć pliku PDF. Sprawdź, czy plik nie jest uszkodzony lub zaszyfrowany.';
  }

  function pluralStr(n, one, few, many) {
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
