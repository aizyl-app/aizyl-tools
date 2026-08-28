/**
 * pdf-to-image.js — PDF na obraz
 * Renderuje wybrane strony PDF jako JPG/PNG/WebP przez pdf.js.
 * Jedna strona — bezpośrednie pobranie, kilka stron — ZIP przez JSZip.
 */
(function () {
  'use strict';

  /* ── Konfiguracja pdf.js ──────────────────────────────────────────── */
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ── Stan aplikacji ───────────────────────────────────────────────── */
  var pages      = [];
  var fileName   = '';
  var idCounter  = 0;
  var errorsList = null;
  var activeFormat = 'jpeg';
  var activeScale  = 2;

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
  var inputQuality   = document.getElementById('inputQuality');
  var valQuality     = document.getElementById('valQuality');
  var qualityGroup   = document.getElementById('qualityGroup');
  var btnDownload    = document.getElementById('btnDownload');
  var btnDownloadLabel = document.getElementById('btnDownloadLabel');
  var exportStatus   = document.getElementById('exportStatus');
  var pageTpl        = document.getElementById('pageTpl');

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
    handleFiles(Array.from(picker.files)); picker.value = '';
  });

  btnSelectAll.addEventListener('click',  function () { setAllSelected(true); });
  btnSelectNone.addEventListener('click', function () { setAllSelected(false); });
  btnNewFile.addEventListener('click',    function () { picker.click(); });
  btnDownload.addEventListener('click',   runDownload);

  /* ── Format ───────────────────────────────────────────────────────── */
  document.querySelectorAll('.format-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.format-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeFormat = btn.dataset.fmt;
      qualityGroup.style.display = activeFormat === 'png' ? 'none' : 'flex';
      updateDownloadLabel();
    });
  });

  /* ── Skala ────────────────────────────────────────────────────────── */
  document.querySelectorAll('.scale-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.scale-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeScale = parseFloat(btn.dataset.scale);
    });
  });

  /* ── Jakość ───────────────────────────────────────────────────────── */
  inputQuality.addEventListener('input', function () {
    valQuality.textContent = inputQuality.value + '%';
  });

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
      setProgress(0.3, 'Ładuję strony...');
      pdfjsLib.getDocument({ data: data }).promise.then(function (pdfDoc) {
        var total = pdfDoc.numPages;
        setProgress(0.6, 'Tworzę miniatury...');
        var newEntries = [];

        for (var p = 1; p <= total; p++) {
          var entry = {
            id:        'p' + (++idCounter),
            pageIndex: p - 1,
            pdfDoc:    pdfDoc,
            selected:  true,
            el:        null
          };
          newEntries.push(entry);
          pages.push(entry);
          var card = createCard(entry);
          entry.el = card;
          pageGrid.appendChild(card);
        }

        setProgress(1, 'Gotowe');
        setTimeout(function () { showProgress(false); }, 300);
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
      var viewport = page.getViewport({ scale: 1 });
      var scale    = 148 / viewport.width;
      var vp       = page.getViewport({ scale: scale });
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
    card.dataset.id  = entry.id;
    card.setAttribute('tabindex', '0');

    var numEl = card.querySelector('.pc-num');
    numEl.textContent = 'Str. ' + (pages.indexOf(entry) + 1);

    card.addEventListener('click', function () {
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

    updateCardState(card, entry);
    return card;
  }

  function updateCardState(card, entry) {
    card.classList.toggle('selected',   entry.selected);
    card.classList.toggle('deselected', !entry.selected);
    card.setAttribute('aria-pressed', String(entry.selected));
  }

  /* ── Zaznaczanie ──────────────────────────────────────────────────── */
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

    var selected = pages.filter(function (p) { return p.selected; }).length;
    wsCount.textContent = pages.length + ' ' +
      pluralStr(pages.length, 'strona', 'strony', 'stron') + ' · ' +
      selected + ' zaznaczone';

    btnDownload.disabled = selected === 0;
    updateDownloadLabel();
  }

  function updateDownloadLabel() {
    var selected = pages.filter(function (p) { return p.selected; }).length;
    var ext = activeFormat === 'jpeg' ? 'JPG' : activeFormat.toUpperCase();
    if (selected <= 1) {
      btnDownloadLabel.textContent = 'Pobierz jako ' + ext;
    } else {
      btnDownloadLabel.textContent = 'Pobierz ' + selected + ' obrazów (ZIP)';
    }
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
    exportStatus.textContent = '';
    if (errorsList) errorsList.innerHTML = '';
  }

  /* ── Pobieranie ───────────────────────────────────────────────────── */
  function runDownload() {
    var selected = pages.filter(function (p) { return p.selected; });
    if (selected.length === 0) return;

    setBusy(true);
    exportStatus.textContent = 'Renderuję...';

    var quality  = parseInt(inputQuality.value, 10) / 100;
    var mimeType = 'image/' + activeFormat;
    var ext      = activeFormat === 'jpeg' ? 'jpg' : activeFormat;
    var baseName = fileName.replace(/\.pdf$/i, '');
    var total    = selected.length;
    var done     = 0;

    if (total === 1) {
      renderPageToBlob(selected[0], mimeType, quality, activeScale).then(function (blob) {
        var pageNum = String(selected[0].pageIndex + 1).padStart(3, '0');
        downloadBlob(blob, baseName + '-strona-' + pageNum + '.' + ext);
        exportStatus.textContent = 'Pobrano.';
      }).catch(function (err) {
        exportStatus.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany błąd');
      }).then(function () { setBusy(false); });
      return;
    }

    var zip   = new JSZip();
    var chain = selected.reduce(function (prev, entry) {
      return prev.then(function () {
        return renderPageToBlob(entry, mimeType, quality, activeScale).then(function (blob) {
          var pageNum = String(entry.pageIndex + 1).padStart(3, '0');
          zip.file(baseName + '-strona-' + pageNum + '.' + ext, blob);
          done++;
          exportStatus.textContent = 'Renderuję ' + done + ' / ' + total + '...';
        });
      });
    }, Promise.resolve());

    chain.then(function () {
      exportStatus.textContent = 'Pakuję ZIP...';
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) {
      downloadBlob(blob, baseName + '-obrazy.zip');
      exportStatus.textContent = 'Pobrano ' + total + ' ' + pluralStr(total, 'obraz', 'obrazy', 'obrazów') + '.';
    }).catch(function (err) {
      exportStatus.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany błąd');
    }).then(function () { setBusy(false); });
  }

  function renderPageToBlob(entry, mimeType, quality, scale) {
    return entry.pdfDoc.getPage(entry.pageIndex + 1).then(function (page) {
      var viewport = page.getViewport({ scale: scale });
      var canvas   = document.createElement('canvas');
      canvas.width  = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      return page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: viewport
      }).promise.then(function () {
        return new Promise(function (resolve) {
          canvas.toBlob(function (blob) { resolve(blob); }, mimeType, quality);
        });
      });
    });
  }

  /* ── Pomocnicze ───────────────────────────────────────────────────── */
  function setBusy(busy) {
    btnDownload.disabled  = busy;
    btnSelectAll.disabled = busy;
    btnSelectNone.disabled = busy;
    btnNewFile.disabled   = busy;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function classifyPdfError(err) {
    var msg = (err && err.message) ? err.message.toLowerCase() : '';
    if (msg.indexOf('password') !== -1 || msg.indexOf('encrypted') !== -1)
      return 'Plik jest zabezpieczony hasłem. Usuń ochronę przed konwersją.';
    if (msg.indexOf('invalid pdf') !== -1 || msg.indexOf('missing pdf') !== -1)
      return 'Plik jest uszkodzony lub nie jest prawidłowym dokumentem PDF.';
    return 'Nie udało się otworzyć pliku PDF. Sprawdź, czy plik nie jest uszkodzony lub zaszyfrowany.';
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
        '<span class="ti ti-x"></span>' +
      '</button>';
    item.querySelector('.file-error-close').addEventListener('click', function () { item.remove(); });
    list.appendChild(item);
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
