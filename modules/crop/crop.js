/**
 * crop.js – Przycinanie stron PDF
 * Użytkownik zaznacza myszką obszar do zachowania.
 * pdf-lib ustawia CropBox per stronę. Wszystko lokalnie.
 */
(function () {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var pdfDoc           = null;
  var originalBytes    = null;
  var originalFileName = null;
  var numPages         = 0;
  var currentPage      = 1;
  var renderScale      = 1.5;
  var crops            = {};  /* { pageIdx(0-based): {x,y,w,h} w punktach PDF } */
  var isDrawing        = false;
  var drawStart        = null;
  var errorBox         = null;

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone      = document.getElementById('dropzone');
  var picker        = document.getElementById('picker');
  var loadProgress  = document.getElementById('loadProgress');
  var lpFill        = document.getElementById('lpFill');
  var lpLabel       = document.getElementById('lpLabel');
  var workspace     = document.getElementById('workspace');
  var pdfCanvas     = document.getElementById('pdfCanvas');
  var overlayCanvas = document.getElementById('overlayCanvas');
  var btnPrev       = document.getElementById('btnPrev');
  var btnNext       = document.getElementById('btnNext');
  var pageLabel     = document.getElementById('pageLabel');
  var btnClearPage  = document.getElementById('btnClearPage');
  var btnClearAll   = document.getElementById('btnClearAll');
  var btnChangeFile = document.getElementById('btnChangeFile');
  var btnSave       = document.getElementById('btnSave');
  var saveInfo      = document.getElementById('saveInfo');
  var applyAllChk   = document.getElementById('applyAll');
  var cropCount     = document.getElementById('cropCount');

  var pdfCtx     = pdfCanvas.getContext('2d');
  var overlayCtx = overlayCanvas.getContext('2d');

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

  btnPrev.addEventListener('click', function () { goToPage(currentPage - 1); });
  btnNext.addEventListener('click', function () { goToPage(currentPage + 1); });
  btnClearPage.addEventListener('click', clearCurrentPage);
  btnClearAll.addEventListener('click', function () {
    crops = {}; btnSave.disabled = true; renderOverlay(); updateMeta();
  });
  btnChangeFile.addEventListener('click', function () { picker.click(); });
  btnSave.addEventListener('click', savePDF);

  /* ── Obsługa pliku ────────────────────────────────────────────────── */
  function handleFiles(files) {
    var pdf = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].type === 'application/pdf' || files[i].name.toLowerCase().endsWith('.pdf')) {
        pdf = files[i]; break;
      }
    }
    if (!pdf) { showError('To nie jest plik PDF. Obsługiwane są wyłącznie pliki .pdf.'); return; }
    resetState();
    loadFile(pdf);
  }

  function resetState() {
    pdfDoc = null; originalBytes = null; originalFileName = null;
    numPages = 0; currentPage = 1; crops = {};
    isDrawing = false; drawStart = null;
    pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    saveInfo.textContent = '';
    btnSave.disabled = true;
  }

  function loadFile(file) {
    originalFileName = file.name;
    showProgress(true, 0, 'Wczytuję plik…');

    var reader = new FileReader();
    reader.onload = function (e) {
      var arrayBuffer = e.target.result;
      originalBytes = new Uint8Array(arrayBuffer.slice(0));
      var data = new Uint8Array(arrayBuffer);

      pdfjsLib.getDocument({ data: data }).promise.then(function (doc) {
        pdfDoc = doc;
        numPages = doc.numPages;
        showProgress(false);
        dropzone.style.display = 'none';
        workspace.hidden = false;
        renderPage(1);
      }, function (err) {
        showProgress(false);
        showError(classifyPdfError(err));
      });
    };
    reader.onerror = function () {
      showProgress(false);
      showError('Nie udało się odczytać pliku. Sprawdź, czy plik nie jest uszkodzony.');
    };
    reader.readAsArrayBuffer(file);
  }

  /* ── Renderowanie strony ──────────────────────────────────────────── */
  function renderPage(pageNum) {
    currentPage = pageNum;
    updateNav();

    pdfDoc.getPage(pageNum).then(function (page) {
      var baseVP = page.getViewport({ scale: 1 });
      var containerW = Math.min((pdfCanvas.parentElement || document.body).clientWidth || 800, 860);
      renderScale = containerW / baseVP.width;

      var vp = page.getViewport({ scale: renderScale });
      pdfCanvas.width      = vp.width;
      pdfCanvas.height     = vp.height;
      overlayCanvas.width  = vp.width;
      overlayCanvas.height = vp.height;

      return page.render({ canvasContext: pdfCtx, viewport: vp }).promise;
    }).then(function () {
      renderOverlay();
    });
  }

  /* ── Overlay ──────────────────────────────────────────────────────── */
  function renderOverlay(previewRect) {
    var w = overlayCanvas.width;
    var h = overlayCanvas.height;
    overlayCtx.clearRect(0, 0, w, h);

    var crop = crops[currentPage - 1];
    var rect = previewRect || (crop ? pdfToCanvas(crop) : null);

    if (rect) {
      /* Przyciemnij obszar poza zaznaczeniem */
      overlayCtx.fillStyle = 'rgba(0,0,0,0.52)';
      overlayCtx.fillRect(0, 0, w, h);
      /* Wyczyść obszar do zachowania */
      overlayCtx.clearRect(rect.x, rect.y, rect.w, rect.h);
      /* Obramowanie zaznaczenia */
      overlayCtx.strokeStyle = '#0B6951';
      overlayCtx.lineWidth   = 2;
      overlayCtx.setLineDash([]);
      overlayCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }

    updateMeta();
  }

  /* ── Konwersja współrzędnych ───────────────────────────────────────── */
  function pdfToCanvas(r) {
    var pageH = pdfCanvas.height / renderScale;
    return {
      x: r.x * renderScale,
      y: (pageH - r.y - r.h) * renderScale,
      w: r.w * renderScale,
      h: r.h * renderScale
    };
  }

  function canvasToPdf(cx, cy, cw, ch) {
    var pageH = pdfCanvas.height / renderScale;
    return {
      x: cx / renderScale,
      y: pageH - (cy + ch) / renderScale,
      w: cw / renderScale,
      h: ch / renderScale
    };
  }

  /* ── Rysowanie myszką ─────────────────────────────────────────────── */
  overlayCanvas.addEventListener('mousedown', function (e) {
    isDrawing = true; drawStart = getCanvasPos(e);
  });
  overlayCanvas.addEventListener('mousemove', function (e) {
    if (!isDrawing) return;
    renderOverlay(makeRect(drawStart, getCanvasPos(e)));
  });
  overlayCanvas.addEventListener('mouseup', function (e) {
    if (!isDrawing) return;
    isDrawing = false; commitRect(drawStart, getCanvasPos(e));
  });
  overlayCanvas.addEventListener('mouseleave', function () {
    if (!isDrawing) return;
    isDrawing = false; renderOverlay();
  });

  overlayCanvas.addEventListener('touchstart', function (e) {
    e.preventDefault(); isDrawing = true; drawStart = getCanvasPos(e.touches[0]);
  }, { passive: false });
  overlayCanvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (!isDrawing) return;
    renderOverlay(makeRect(drawStart, getCanvasPos(e.touches[0])));
  }, { passive: false });
  overlayCanvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    if (!isDrawing) return;
    isDrawing = false; commitRect(drawStart, getCanvasPos(e.changedTouches[0]));
  }, { passive: false });

  function makeRect(start, cur) {
    return {
      x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y),
      w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y)
    };
  }

  function commitRect(start, cur) {
    var r = makeRect(start, cur);
    if (r.w < 5 || r.h < 5) { renderOverlay(); return; }
    crops[currentPage - 1] = canvasToPdf(r.x, r.y, r.w, r.h);
    btnSave.disabled = false;
    renderOverlay();
  }

  function getCanvasPos(e) {
    var rect = overlayCanvas.getBoundingClientRect();
    var sx = overlayCanvas.width  / rect.width;
    var sy = overlayCanvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  /* ── Operacje ─────────────────────────────────────────────────────── */
  function clearCurrentPage() {
    delete crops[currentPage - 1];
    if (Object.keys(crops).length === 0) btnSave.disabled = true;
    renderOverlay();
  }

  function goToPage(num) {
    if (!pdfDoc || num < 1 || num > numPages) return;
    renderPage(num);
  }

  function updateNav() {
    pageLabel.textContent = 'Strona ' + currentPage + ' z ' + numPages;
    btnPrev.disabled = (currentPage <= 1);
    btnNext.disabled = (currentPage >= numPages);
  }

  function updateMeta() {
    var idx     = currentPage - 1;
    var hasCrop = !!crops[idx];
    var total   = Object.keys(crops).length;
    if (hasCrop) {
      cropCount.textContent = 'Ta strona: zaznaczone · łącznie ' + total + ' ' +
        pluralStr(total, 'strona', 'strony', 'stron');
    } else {
      cropCount.textContent = total > 0
        ? 'Ta strona: brak zaznaczenia · ' + total + ' ' + pluralStr(total, 'inna strona', 'inne strony', 'innych stron') + ' ma przycinanie'
        : 'Zaznacz myszką obszar do zachowania';
    }
  }

  /* ── Zapis PDF ────────────────────────────────────────────────────── */
  function savePDF() {
    var PDFLib = window.PDFLib;
    if (!PDFLib || !originalBytes) return;
    if (Object.keys(crops).length === 0) return;

    var applyAll = applyAllChk && applyAllChk.checked;
    var total    = Object.keys(crops).length;

    btnSave.disabled = true;
    saveInfo.textContent = 'Przygotowuję plik…';

    PDFLib.PDFDocument.load(originalBytes).then(function (doc) {
      var pdfPages = doc.getPages();

      if (applyAll) {
        var firstKey = Object.keys(crops)[0];
        var r = crops[parseInt(firstKey, 10)];
        pdfPages.forEach(function (page) {
          page.setCropBox(r.x, r.y, r.w, r.h);
        });
      } else {
        Object.keys(crops).forEach(function (keyStr) {
          var idx  = parseInt(keyStr, 10);
          var r    = crops[idx];
          if (pdfPages[idx]) {
            pdfPages[idx].setCropBox(r.x, r.y, r.w, r.h);
          }
        });
      }

      return doc.save();
    }).then(function (bytes) {
      var dot  = originalFileName ? originalFileName.lastIndexOf('.') : -1;
      var base = (dot !== -1) ? originalFileName.substring(0, dot) : (originalFileName || 'dokument');
      downloadBytes(bytes, base + '-przycięty.pdf');
      saveInfo.textContent = 'Pobrano · ' + (applyAll ? numPages : total) + ' ' +
        pluralStr(applyAll ? numPages : total, 'strona', 'strony', 'stron');
      btnSave.disabled = false;
    }).catch(function (err) {
      saveInfo.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany');
      btnSave.disabled = false;
    });
  }

  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  /* ── UI helpers ───────────────────────────────────────────────────── */
  function showProgress(visible, ratio, label) {
    loadProgress.style.display = visible ? 'flex' : 'none';
    if (visible && ratio !== undefined) {
      lpFill.style.width = Math.round(ratio * 100) + '%';
      lpLabel.textContent = label || '';
    }
  }

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
      return 'Plik jest zabezpieczony hasłem. Usuń ochronę przed przycinaniem.';
    return 'Nie udało się otworzyć pliku PDF. Sprawdź, czy plik nie jest uszkodzony.';
  }

  function pluralStr(n, one, few, many) {
    if (n === 1) return one; if (n >= 2 && n <= 4) return few; return many;
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
