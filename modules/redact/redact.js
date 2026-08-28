/**
 * redact.js – Redagowanie (zaczernianie) stron PDF
 * pdf.js (podgląd + overlay) + pdf-lib (trwałe czarne prostokąty).
 * Współrzędne: canvas px → punkty PDF (Y odwrócone).
 * Wszystko lokalnie.
 */
(function () {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var pdfDoc          = null;
  var originalBytes   = null;
  var originalFileName = null;
  var numPages        = 0;
  var currentPage     = 1;
  var renderScale     = 1.5;
  var redactions      = {};   /* { pageIdx(0-based): [{x,y,w,h}] } w punktach PDF */
  var isDrawing       = false;
  var drawStart       = null; /* {x,y} w pikselach canvas */
  var errorBox        = null;

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
  var btnUndo       = document.getElementById('btnUndo');
  var btnClearPage  = document.getElementById('btnClearPage');
  var btnChangeFile = document.getElementById('btnChangeFile');
  var btnSave       = document.getElementById('btnSave');
  var saveInfo      = document.getElementById('saveInfo');
  var redactList    = document.getElementById('redactList');
  var redactCount   = document.getElementById('redactCount');

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

  /* ── Toolbar ──────────────────────────────────────────────────────── */
  btnPrev.addEventListener('click', function () { goToPage(currentPage - 1); });
  btnNext.addEventListener('click', function () { goToPage(currentPage + 1); });
  btnUndo.addEventListener('click', undoLast);
  btnClearPage.addEventListener('click', clearCurrentPage);
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
    pdfDoc = null;
    originalBytes = null;
    originalFileName = null;
    numPages = 0;
    currentPage = 1;
    redactions = {};
    isDrawing = false;
    drawStart = null;
    pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    redactList.innerHTML = '';
    redactCount.textContent = '';
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
      var containerW = Math.min(pdfCanvas.parentElement.clientWidth || 800, 860);
      renderScale = containerW / baseVP.width;

      var vp = page.getViewport({ scale: renderScale });
      pdfCanvas.width  = vp.width;
      pdfCanvas.height = vp.height;
      overlayCanvas.width  = vp.width;
      overlayCanvas.height = vp.height;

      return page.render({ canvasContext: pdfCtx, viewport: vp }).promise;
    }).then(function () {
      renderOverlay();
    });
  }

  /* ── Overlay: istniejące zaznaczenia ──────────────────────────────── */
  function renderOverlay(previewRect) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    var list = redactions[currentPage - 1] || [];
    list.forEach(function (r) {
      /* PDF punkty → canvas px; Y odwrócone */
      var cx = r.x * renderScale;
      var cy = overlayCanvas.height - (r.y + r.h) * renderScale;
      var cw = r.w * renderScale;
      var ch = r.h * renderScale;
      overlayCtx.fillStyle = '#000000';
      overlayCtx.fillRect(cx, cy, cw, ch);
    });

    if (previewRect) {
      overlayCtx.fillStyle = 'rgba(0,0,0,0.55)';
      overlayCtx.fillRect(previewRect.x, previewRect.y, previewRect.w, previewRect.h);
    }

    updateMeta();
  }

  /* ── Rysowanie myszką ─────────────────────────────────────────────── */
  overlayCanvas.addEventListener('mousedown', function (e) {
    isDrawing = true;
    drawStart = getCanvasPos(e);
  });

  overlayCanvas.addEventListener('mousemove', function (e) {
    if (!isDrawing) return;
    var cur = getCanvasPos(e);
    renderOverlay(makePreview(drawStart, cur));
  });

  overlayCanvas.addEventListener('mouseup', function (e) {
    if (!isDrawing) return;
    isDrawing = false;
    var cur = getCanvasPos(e);
    commitRect(drawStart, cur);
  });

  overlayCanvas.addEventListener('mouseleave', function () {
    if (!isDrawing) return;
    isDrawing = false;
    renderOverlay();
  });

  /* Touch */
  overlayCanvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    isDrawing = true;
    drawStart = getCanvasPos(e.touches[0]);
  }, { passive: false });

  overlayCanvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (!isDrawing) return;
    renderOverlay(makePreview(drawStart, getCanvasPos(e.touches[0])));
  }, { passive: false });

  overlayCanvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    if (!isDrawing) return;
    isDrawing = false;
    commitRect(drawStart, getCanvasPos(e.changedTouches[0]));
  }, { passive: false });

  function makePreview(start, cur) {
    return {
      x: Math.min(start.x, cur.x),
      y: Math.min(start.y, cur.y),
      w: Math.abs(cur.x - start.x),
      h: Math.abs(cur.y - start.y)
    };
  }

  function commitRect(start, cur) {
    var cx = Math.min(start.x, cur.x);
    var cy = Math.min(start.y, cur.y);
    var cw = Math.abs(cur.x - start.x);
    var ch = Math.abs(cur.y - start.y);

    if (cw < 5 || ch < 5) { renderOverlay(); return; }

    /* canvas px → PDF punkty (Y odwrócone) */
    var pageH = pdfCanvas.height / renderScale;
    var r = {
      x: cx / renderScale,
      y: pageH - (cy + ch) / renderScale,
      w: cw / renderScale,
      h: ch / renderScale
    };

    var idx = currentPage - 1;
    if (!redactions[idx]) redactions[idx] = [];
    redactions[idx].push(r);
    renderOverlay();
  }

  function getCanvasPos(e) {
    var rect = overlayCanvas.getBoundingClientRect();
    var sx = overlayCanvas.width  / rect.width;
    var sy = overlayCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top)  * sy
    };
  }

  /* ── Operacje na zaznaczeniach ────────────────────────────────────── */
  function undoLast() {
    var idx = currentPage - 1;
    if (!redactions[idx] || redactions[idx].length === 0) return;
    redactions[idx].pop();
    renderOverlay();
  }

  function clearCurrentPage() {
    redactions[currentPage - 1] = [];
    renderOverlay();
  }

  function removeRedaction(pageIdx, rectIdx) {
    if (!redactions[pageIdx]) return;
    redactions[pageIdx].splice(rectIdx, 1);
    renderOverlay();
  }

  /* ── Nawigacja ────────────────────────────────────────────────────── */
  function goToPage(num) {
    if (!pdfDoc || num < 1 || num > numPages) return;
    renderPage(num);
  }

  function updateNav() {
    pageLabel.textContent = 'Strona ' + currentPage + ' z ' + numPages;
    btnPrev.disabled = (currentPage <= 1);
    btnNext.disabled = (currentPage >= numPages);
  }

  /* ── Meta: lista i licznik ────────────────────────────────────────── */
  function updateMeta() {
    var idx  = currentPage - 1;
    var list = redactions[idx] || [];
    var total = 0;
    Object.keys(redactions).forEach(function (k) { total += redactions[k].length; });

    redactCount.textContent = list.length > 0
      ? list.length + ' ' + pluralStr(list.length, 'zaznaczenie', 'zaznaczenia', 'zaznaczeń') + ' na tej stronie'
      : 'Brak zaznaczeń na tej stronie';

    btnSave.disabled = (total === 0);

    if (list.length === 0) { redactList.innerHTML = ''; return; }

    redactList.innerHTML = list.map(function (r, i) {
      return '<div class="redact-item">' +
        '<span class="redact-label">Obszar ' + (i + 1) + '</span>' +
        '<button class="redact-remove" data-idx="' + i + '" aria-label="Usuń obszar ' + (i + 1) + '">' +
          '<span class="ti ti-x" aria-hidden="true"></span>' +
        '</button>' +
      '</div>';
    }).join('');

    redactList.querySelectorAll('.redact-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        removeRedaction(idx, parseInt(this.dataset.idx, 10));
      });
    });
  }

  /* ── Zapis PDF ────────────────────────────────────────────────────── */
  function savePDF() {
    var PDFLib = window.PDFLib;
    if (!PDFLib || !originalBytes) return;

    var total = 0;
    Object.keys(redactions).forEach(function (k) { total += redactions[k].length; });
    if (total === 0) return;

    btnSave.disabled = true;
    saveInfo.textContent = 'Rastruję strony…';

    var outDoc;

    PDFLib.PDFDocument.create().then(function (out) {
      outDoc = out;
      var indices = [];
      for (var i = 0; i < numPages; i++) indices.push(i);
      return indices.reduce(function (chain, pageIdx) {
        return chain.then(function () {
          return rasterizePage(pageIdx);
        });
      }, Promise.resolve());
    }).then(function () {
      return outDoc.save();
    }).then(function (bytes) {
      var dot  = originalFileName ? originalFileName.lastIndexOf('.') : -1;
      var base = (dot !== -1) ? originalFileName.substring(0, dot) : (originalFileName || 'dokument');
      downloadBytes(bytes, base + '-zredagowany.pdf');
      saveInfo.textContent = 'Pobrano · ' + total + ' ' +
        pluralStr(total, 'obszar', 'obszary', 'obszarów');
      btnSave.disabled = false;
    }).catch(function (err) {
      saveInfo.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany');
      btnSave.disabled = false;
    });

    function rasterizePage(pageIdx) {
      return pdfDoc.getPage(pageIdx + 1).then(function (page) {
        var baseVP = page.getViewport({ scale: 1 });
        var scale  = 2.0;
        var vp     = page.getViewport({ scale: scale });

        var tmp = document.createElement('canvas');
        tmp.width  = vp.width;
        tmp.height = vp.height;
        var ctx = tmp.getContext('2d');

        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
          var rects = redactions[pageIdx] || [];
          if (rects.length > 0) {
            ctx.fillStyle = '#000000';
            rects.forEach(function (r) {
              var cx = r.x * scale;
              var cy = tmp.height - (r.y + r.h) * scale;
              var cw = r.w * scale;
              var ch = r.h * scale;
              ctx.fillRect(cx, cy, cw, ch);
            });
          }

          var dataUrl  = tmp.toDataURL('image/jpeg', 0.92);
          var b64      = dataUrl.split(',')[1];
          var raw      = atob(b64);
          var imgBytes = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) imgBytes[i] = raw.charCodeAt(i);

          return outDoc.embedJpg(imgBytes).then(function (img) {
            var p = outDoc.addPage([baseVP.width, baseVP.height]);
            p.drawImage(img, { x: 0, y: 0, width: baseVP.width, height: baseVP.height });
          });
        });
      });
    }
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
      return 'Plik jest zabezpieczony hasłem. Usuń ochronę przed redagowaniem.';
    return 'Nie udało się otworzyć pliku PDF. Sprawdź, czy plik nie jest uszkodzony.';
  }

  function pluralStr(n, one, few, many) {
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
