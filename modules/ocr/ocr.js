/**
 * ocr.js – Rozpoznawanie tekstu w PDF (OCR)
 * pdf.js renderuje strony do canvasu → Tesseract.js rozpoznaje tekst.
 * Wszystko działa lokalnie w przeglądarce.
 */
(function () {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var pdfDoc           = null;
  var originalFileName = null;
  var numPages         = 0;
  var isRunning        = false;
  var errorBox         = null;

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone       = document.getElementById('dropzone');
  var picker         = document.getElementById('picker');
  var loadProgress   = document.getElementById('loadProgress');
  var lpFill         = document.getElementById('lpFill');
  var lpLabel        = document.getElementById('lpLabel');
  var workspace      = document.getElementById('workspace');
  var wsCount        = document.getElementById('wsCount');
  var langSelect     = document.getElementById('langSelect');
  var btnRun         = document.getElementById('btnRun');
  var btnChangeFile  = document.getElementById('btnChangeFile');
  var ocrProgress    = document.getElementById('ocrProgress');
  var ocrFill        = document.getElementById('ocrFill');
  var ocrLabel       = document.getElementById('ocrLabel');
  var ocrResult      = document.getElementById('ocrResult');
  var ocrText        = document.getElementById('ocrText');
  var btnCopy        = document.getElementById('btnCopy');
  var btnDownloadTxt = document.getElementById('btnDownloadTxt');

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

  btnRun.addEventListener('click', runOCR);
  btnChangeFile.addEventListener('click', function () { picker.click(); });

  btnCopy.addEventListener('click', function () {
    var text = collectText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () {
      var orig = btnCopy.innerHTML;
      btnCopy.innerHTML = '<span class="ti ti-check" aria-hidden="true"></span> Skopiowano';
      setTimeout(function () { btnCopy.innerHTML = orig; }, 1800);
    });
  });

  btnDownloadTxt.addEventListener('click', function () {
    var text = collectText();
    if (!text) return;
    var dot  = originalFileName ? originalFileName.lastIndexOf('.') : -1;
    var base = (dot !== -1) ? originalFileName.substring(0, dot) : (originalFileName || 'dokument');
    downloadText(text, base + '-ocr.txt');
  });

  /* ── Obsługa pliku ────────────────────────────────────────────────── */
  function handleFiles(files) {
    var pdf = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].type === 'application/pdf' || files[i].name.toLowerCase().endsWith('.pdf')) {
        pdf = files[i]; break;
      }
    }
    if (!pdf) { showError('To nie jest plik PDF. Obsługiwane są wyłącznie pliki .pdf.'); return; }
    loadFile(pdf);
  }

  function loadFile(file) {
    originalFileName = file.name;
    pdfDoc = null; numPages = 0;
    ocrResult.hidden = true;
    ocrText.innerHTML = '';
    showProgress(true, 0, 'Wczytuję plik…');

    var reader = new FileReader();
    reader.onload = function (e) {
      var data = new Uint8Array(e.target.result);
      pdfjsLib.getDocument({ data: data }).promise.then(function (doc) {
        pdfDoc    = doc;
        numPages  = doc.numPages;
        showProgress(false);
        dropzone.style.display = 'none';
        workspace.hidden = false;
        wsCount.textContent = numPages + ' ' + pluralStr(numPages, 'strona', 'strony', 'stron') +
          ' · kliknij „Rozpoznaj tekst"';
      }, function (err) {
        showProgress(false);
        showError(classifyPdfError(err));
      });
    };
    reader.onerror = function () {
      showProgress(false);
      showError('Nie udało się odczytać pliku.');
    };
    reader.readAsArrayBuffer(file);
  }

  /* ── OCR ──────────────────────────────────────────────────────────── */
  function runOCR() {
    if (!pdfDoc || isRunning) return;
    isRunning = true;

    var lang = langSelect.value || 'pol';
    btnRun.disabled = true;
    ocrResult.hidden = true;
    ocrText.innerHTML = '';
    ocrProgress.style.display = 'flex';
    setOcrProgress(0, 'Inicjalizuję silnik OCR…');

    var workerOptions = {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      langPath:   'https://tessdata.projectnaptha.com/4.0.0',
      corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
      logger: function (m) {
        if (m.status === 'loading tesseract core' || m.status === 'initializing tesseract') {
          setOcrProgress(m.progress * 0.1, 'Ładuję silnik OCR…');
        }
        if (m.status === 'loading language traineddata') {
          setOcrProgress(0.1 + m.progress * 0.15, 'Pobieram model językowy…');
        }
      }
    };

    var worker;
    Tesseract.createWorker(lang, 1, workerOptions).then(function (w) {
      worker = w;
      var results = [];
      var indices = [];
      for (var i = 1; i <= numPages; i++) indices.push(i);

      return indices.reduce(function (chain, pageNum) {
        return chain.then(function () {
          var pct = 0.25 + ((pageNum - 1) / numPages) * 0.75;
          setOcrProgress(pct, 'Strona ' + pageNum + ' z ' + numPages + '…');
          return renderPageToCanvas(pageNum).then(function (canvas) {
            return worker.recognize(canvas);
          }).then(function (result) {
            results.push({ page: pageNum, text: result.data.text });
          });
        });
      }, Promise.resolve()).then(function () { return results; });
    }).then(function (results) {
      worker.terminate();
      displayResults(results);
      ocrProgress.style.display = 'none';
      ocrResult.hidden   = false;
      btnRun.disabled    = false;
      isRunning          = false;
    }).catch(function (err) {
      if (worker) worker.terminate();
      setOcrProgress(0, 'Błąd: ' + (err && err.message ? err.message : 'nieznany'));
      btnRun.disabled = false;
      isRunning       = false;
    });
  }

  function renderPageToCanvas(pageNum) {
    return pdfDoc.getPage(pageNum).then(function (page) {
      var vp  = page.getViewport({ scale: 2.0 });
      var tmp = document.createElement('canvas');
      tmp.width  = vp.width;
      tmp.height = vp.height;
      return page.render({ canvasContext: tmp.getContext('2d'), viewport: vp }).promise
        .then(function () { return tmp; });
    });
  }

  function displayResults(results) {
    ocrText.innerHTML = results.map(function (r) {
      var safe = escHtml(r.text.trim());
      return '<div class="ocr-page">' +
        '<div class="ocr-page-label">Strona ' + r.page + '</div>' +
        '<pre class="ocr-page-text">' + safe + '</pre>' +
      '</div>';
    }).join('');
  }

  function collectText() {
    var blocks = ocrText.querySelectorAll('.ocr-page-text');
    var parts  = [];
    blocks.forEach(function (b) { parts.push(b.textContent); });
    return parts.join('\n\n--- \n\n');
  }

  /* ── Postęp ───────────────────────────────────────────────────────── */
  function showProgress(visible, ratio, label) {
    loadProgress.style.display = visible ? 'flex' : 'none';
    if (visible && ratio !== undefined) {
      lpFill.style.width  = Math.round(ratio * 100) + '%';
      lpLabel.textContent = label || '';
    }
  }

  function setOcrProgress(ratio, label) {
    ocrFill.style.width  = Math.round(Math.min(ratio, 1) * 100) + '%';
    ocrLabel.textContent = label || '';
  }

  /* ── Pobieranie txt ───────────────────────────────────────────────── */
  function downloadText(text, filename) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  /* ── Błędy ────────────────────────────────────────────────────────── */
  function showError(message) {
    if (!errorBox) {
      errorBox = document.createElement('div');
      errorBox.className = 'file-error';
      errorBox.setAttribute('role', 'alert');
      dropzone.parentNode.insertBefore(errorBox, dropzone.nextSibling);
    }
    errorBox.hidden = false;
    errorBox.innerHTML =
      '<span class="ti ti-alert-circle" aria-hidden="true"></span>' +
      '<div class="file-error-body"><div class="file-error-msg">' + escHtml(message) + '</div></div>' +
      '<button class="file-error-close" aria-label="Zamknij">' +
        '<span class="ti ti-x" aria-hidden="true"></span></button>';
    errorBox.querySelector('.file-error-close').addEventListener('click', function () {
      errorBox.hidden = true;
    });
  }

  function classifyPdfError(err) {
    var msg = (err && err.message) ? err.message.toLowerCase() : '';
    if (msg.indexOf('password') !== -1 || msg.indexOf('encrypted') !== -1)
      return 'Plik jest zabezpieczony hasłem. Usuń ochronę przed rozpoznaniem tekstu.';
    return 'Nie udało się otworzyć pliku PDF. Sprawdź, czy plik nie jest uszkodzony.';
  }

  /* ── Pomocnicze ───────────────────────────────────────────────────── */
  function pluralStr(n, one, few, many) {
    if (n === 1) return one; if (n >= 2 && n <= 4) return few; return many;
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
