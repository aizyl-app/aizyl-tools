/**
 * compress.js — Kompresja PDF
 * Renderuje strony na canvas jako JPEG i pakuje z powrotem przez pdf-lib.
 * Żadne dane użytkownika nie opuszczają przeglądarki.
 */
(function () {
  'use strict';

  /* ── Konfiguracja pdf.js ──────────────────────────────────────────── */
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ── Presety kompresji ────────────────────────────────────────────── */
  var PRESETS = {
    small:   { scale: 1.0, quality: 0.42 },
    balance: { scale: 1.5, quality: 0.66 },
    quality: { scale: 2.0, quality: 0.82 }
  };

  /* ── Stan aplikacji ───────────────────────────────────────────────── */
  var fileName      = '';
  var fileSize      = 0;
  var fileBytes     = null;
  var activePreset  = 'balance';
  var resultBytes   = null;
  var errorsList    = null;

  /* ── Elementy DOM ─────────────────────────────────────────────────── */
  var dropzone      = document.getElementById('dropzone');
  var picker        = document.getElementById('picker');
  var workspace     = document.getElementById('workspace');
  var fileInfo      = document.getElementById('fileInfo');
  var btnCompress   = document.getElementById('btnCompress');
  var btnNewFile    = document.getElementById('btnNewFile');
  var loadProgress  = document.getElementById('loadProgress');
  var lpFill        = document.getElementById('lpFill');
  var lpLabel       = document.getElementById('lpLabel');
  var resultCard    = document.getElementById('resultCard');
  var sizeBefore    = document.getElementById('sizeBefore');
  var sizeAfter     = document.getElementById('sizeAfter');
  var resultBadge   = document.getElementById('resultBadge');
  var btnDownload   = document.getElementById('btnDownload');

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

  btnNewFile.addEventListener('click',  function () { picker.click(); });
  btnCompress.addEventListener('click', runCompress);
  btnDownload.addEventListener('click', downloadResult);

  /* ── Presety ──────────────────────────────────────────────────────── */
  document.querySelectorAll('.quality-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.quality-btn').forEach(function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      activePreset = btn.dataset.preset;
      resetResult();
    });
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
    var reader = new FileReader();
    reader.onload = function (e) {
      fileBytes = new Uint8Array(e.target.result);
      fileName  = file.name;
      fileSize  = file.size;
      resultBytes = null;
      resetResult();
      showWorkspace(file);
    };
    reader.onerror = function () {
      showError(file.name, 'Nie udało się odczytać pliku. Sprawdź, czy plik nie jest uszkodzony.');
    };
    reader.readAsArrayBuffer(file);
  }

  function showWorkspace(file) {
    fileInfo.innerHTML =
      '<span class="ti ti-file-type-pdf" aria-hidden="true"></span>' +
      '<span class="file-info-name">' + escHtml(file.name) + '</span>' +
      '<span class="file-info-size">' + formatSize(file.size) + '</span>';
    workspace.hidden = false;
  }

  /* ── Kompresja ────────────────────────────────────────────────────── */
  function runCompress() {
    if (!fileBytes) return;

    var preset = PRESETS[activePreset];
    setBusy(true);
    resetResult();
    showProgress(true);
    setProgress(0, 'Otwieram PDF...');

    pdfjsLib.getDocument({ data: fileBytes }).promise.then(function (pdfDoc) {
      var totalPages = pdfDoc.numPages;
      var PDFLib     = window.PDFLib;

      if (!PDFLib) {
        throw new Error('Biblioteka pdf-lib niedostępna.');
      }

      return PDFLib.PDFDocument.create().then(function (outDoc) {
        var chain = Promise.resolve();

        for (var i = 1; i <= totalPages; i++) {
          (function (pageNum) {
            chain = chain.then(function () {
              setProgress(
                (pageNum - 1) / totalPages,
                'Strona ' + pageNum + ' z ' + totalPages
              );
              return processPage(pdfDoc, outDoc, pageNum, preset);
            });
          })(i);
        }

        return chain.then(function () {
          setProgress(1, 'Zapisuję...');
          return outDoc.save();
        });
      });
    }).then(function (bytes) {
      resultBytes = bytes;
      showResult(fileSize, bytes.length);
    }).catch(function (err) {
      showError(fileName, 'Błąd kompresji: ' + (err && err.message ? err.message : 'nieznany błąd'));
    }).then(function () {
      showProgress(false);
      setBusy(false);
    });
  }

  /* ── Przetwarzanie jednej strony ──────────────────────────────────── */
  function processPage(pdfDoc, outDoc, pageNum, preset) {
    return pdfDoc.getPage(pageNum).then(function (page) {
      var origViewport = page.getViewport({ scale: 1 });
      var viewport     = page.getViewport({ scale: preset.scale });

      var canvas    = document.createElement('canvas');
      canvas.width  = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      return page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: viewport
      }).promise.then(function () {
        var dataUrl   = canvas.toDataURL('image/jpeg', preset.quality);
        var base64    = dataUrl.split(',')[1];
        var jpegBytes = base64ToUint8Array(base64);

        /* Zwolnij pamięć canvasa */
        canvas.width  = 1;
        canvas.height = 1;

        return window.PDFLib.PDFDocument.load(
          new Uint8Array([37,80,68,70,45,49,46,52,10]) /* nagłówek PDF — embedJpg nie wymaga pełnego doc */
        ).catch(function () {
          return outDoc;
        }).then(function () {
          return outDoc.embedJpg(jpegBytes);
        }).then(function (jpgImage) {
          var outPage = outDoc.addPage([origViewport.width, origViewport.height]);
          outPage.drawImage(jpgImage, {
            x: 0, y: 0,
            width:  origViewport.width,
            height: origViewport.height
          });
        });
      });
    });
  }

  /* ── Pobieranie wyniku ────────────────────────────────────────────── */
  function downloadResult() {
    if (!resultBytes) return;
    var baseName = fileName.replace(/\.pdf$/i, '');
    downloadBlob(
      new Blob([resultBytes], { type: 'application/pdf' }),
      baseName + '-skompresowany.pdf'
    );
  }

  /* ── UI helpers ───────────────────────────────────────────────────── */
  function showProgress(visible) { loadProgress.hidden = !visible; }

  function setProgress(ratio, label) {
    lpFill.style.width  = Math.round(ratio * 100) + '%';
    lpLabel.textContent = label;
  }

  function showResult(before, after) {
    sizeBefore.textContent = formatSize(before);
    sizeAfter.textContent  = formatSize(after);
    var pct = Math.round((1 - after / before) * 100);
    resultBadge.textContent = pct > 0 ? '-' + pct + '%' : '+' + Math.abs(pct) + '%';
    resultCard.hidden = false;
  }

  function resetResult() {
    resultCard.hidden = true;
    resultBytes = null;
  }

  function setBusy(busy) {
    btnCompress.disabled = busy;
    btnNewFile.disabled  = busy;
  }

  /* ── Pomocnicze ───────────────────────────────────────────────────── */
  function formatSize(bytes) {
    if (bytes < 1024)       return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function base64ToUint8Array(base64) {
    var binary = atob(base64);
    var bytes  = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
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

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
