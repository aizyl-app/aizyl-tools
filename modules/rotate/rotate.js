/**
 * rotate.js — Obracanie stron PDF
 * Obraca wybrane strony o 90° i zapisuje przez pdf-lib.
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
   *             rotation: number, el: HTMLElement|null }} PageEntry
   */
  /** @type {PageEntry[]} */
  var pages      = [];
  var fileName   = '';
  var idCounter  = 0;
  var errorsList = null;

  /* ── Elementy DOM ─────────────────────────────────────────────────── */
  var dropzone        = document.getElementById('dropzone');
  var picker          = document.getElementById('picker');
  var loadProgress    = document.getElementById('loadProgress');
  var lpFill          = document.getElementById('lpFill');
  var lpLabel         = document.getElementById('lpLabel');
  var workspace       = document.getElementById('workspace');
  var wsCount         = document.getElementById('wsCount');
  var pageGrid        = document.getElementById('pageGrid');
  var btnRotateAllLeft  = document.getElementById('btnRotateAllLeft');
  var btnRotateAllRight = document.getElementById('btnRotateAllRight');
  var btnNewFile      = document.getElementById('btnNewFile');
  var btnDownload     = document.getElementById('btnDownload');
  var rotateStatus    = document.getElementById('rotateStatus');
  var pageTpl         = document.getElementById('pageTpl');

  /* ── Dropzone ─────────────────────────────────────────────────────── */
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

  btnRotateAllLeft.addEventListener('click',  function () { rotateAll(-90); });
  btnRotateAllRight.addEventListener('click', function () { rotateAll(90); });
  btnNewFile.addEventListener('click',  function () { picker.click(); });
  btnDownload.addEventListener('click', runDownload);

  /* ── Obsługa pliku ────────────────────────────────────────────────── */
  function handleFiles(files) {
    var pdf = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].type === 'application/pdf' || files[i].name.toLowerCase().endsWith('.pdf')) {
        pdf = files[i]; break;
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
    setProgress(0, 'Otwieram plik...');

    var reader = new FileReader();
    reader.onload = function (e) {
      var data = new Uint8Array(e.target.result);
      pdfjsLib.getDocument({ data: data }).promise.then(function (pdfDoc) {
        var total = pdfDoc.numPages;
        var newEntries = [];

        for (var p = 1; p <= total; p++) {
          var entry = {
            id:        'p' + (++idCounter),
            pageIndex: p - 1,
            pdfDoc:    pdfDoc,
            rotation:  0,
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

    var numEl  = card.querySelector('.pc-num');
    var degEl  = card.querySelector('.pc-deg');
    var btnL   = card.querySelector('.pc-rotate-left');
    var btnR   = card.querySelector('.pc-rotate-right');

    numEl.textContent = 'Str. ' + (pages.indexOf(entry) + 1);
    degEl.textContent = '0°';

    btnL.addEventListener('click', function () { rotateEntry(entry, -90); });
    btnR.addEventListener('click', function () { rotateEntry(entry, 90); });

    return card;
  }

  /* ── Obrót pojedynczej strony ─────────────────────────────────────── */
  function rotateEntry(entry, delta) {
    entry.rotation = ((entry.rotation + delta) % 360 + 360) % 360;
    updateCardState(entry);
    renderThumbnail(entry);
    updateWorkspace();
  }

  function updateCardState(entry) {
    if (!entry.el) return;
    var degEl = entry.el.querySelector('.pc-deg');
    degEl.textContent = entry.rotation + '°';
    entry.el.classList.toggle('rotated', entry.rotation !== 0);
  }

  /* ── Obrót wszystkich stron ───────────────────────────────────────── */
  function rotateAll(delta) {
    pages.forEach(function (entry) {
      entry.rotation = ((entry.rotation + delta) % 360 + 360) % 360;
      updateCardState(entry);
      renderThumbnail(entry);
    });
    updateWorkspace();
  }

  /* ── Aktualizacja UI ──────────────────────────────────────────────── */
  function updateWorkspace() {
    if (pages.length === 0) { workspace.hidden = true; return; }
    workspace.hidden = false;

    var rotated = pages.filter(function (p) { return p.rotation !== 0; }).length;
    wsCount.textContent = pages.length + ' ' +
      pluralStr(pages.length, 'strona', 'strony', 'stron') +
      (rotated > 0 ? ' · ' + rotated + ' obrócone' : '');
  }

  /* ── Postęp ───────────────────────────────────────────────────────── */
  function showProgress(visible) { loadProgress.hidden = !visible; }
  function setProgress(ratio, label) {
    lpFill.style.width  = Math.round(ratio * 100) + '%';
    lpLabel.textContent = label;
  }

  /* ── Czyszczenie ──────────────────────────────────────────────────── */
  function clearAll() {
    pages     = [];
    idCounter = 0;
    pageGrid.innerHTML       = '';
    rotateStatus.textContent = '';
    if (errorsList) errorsList.innerHTML = '';
  }

  /* ── Pobieranie ───────────────────────────────────────────────────── */
  function runDownload() {
    if (pages.length === 0) return;

    setBusy(true);
    rotateStatus.textContent = 'Zapisuję...';

    var PDFLib = window.PDFLib;
    if (!PDFLib) {
      rotateStatus.textContent = 'Błąd: biblioteka pdf-lib niedostępna.';
      setBusy(false);
      return;
    }

    PDFLib.PDFDocument.create().then(function (outDoc) {
      return pages.reduce(function (chain, entry) {
        return chain.then(function () { return copyPage(outDoc, entry); });
      }, Promise.resolve()).then(function () { return outDoc.save(); });
    }).then(function (bytes) {
      var baseName = fileName.replace(/\.pdf$/i, '');
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), baseName + '-obrócony.pdf');
      rotateStatus.textContent = 'Pobrano.';
    }).catch(function (err) {
      rotateStatus.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany błąd');
    }).then(function () { setBusy(false); });
  }

  function copyPage(outDoc, entry) {
    var PDFLib = window.PDFLib;
    return entry.pdfDoc.getData().then(function (data) {
      return PDFLib.PDFDocument.load(data, { ignoreEncryption: false });
    }).then(function (srcDoc) {
      return outDoc.copyPages(srcDoc, [entry.pageIndex]);
    }).then(function (copiedPages) {
      var page    = copiedPages[0];
      var current = page.getRotation().angle;
      page.setRotation(PDFLib.degrees((current + entry.rotation) % 360));
      outDoc.addPage(page);
    });
  }

  /* ── Pomocnicze ───────────────────────────────────────────────────── */
  function setBusy(busy) {
    btnDownload.disabled      = busy;
    btnRotateAllLeft.disabled = busy;
    btnRotateAllRight.disabled = busy;
    btnNewFile.disabled       = busy;
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
      return 'Plik jest zabezpieczony hasłem. Usuń ochronę przed obróceniem stron.';
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
