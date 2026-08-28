/**
 * crop-image.js – Przycinanie obrazów
 * Canvas: rysuj obraz → overlay z zaznaczeniem myszką → wytnij fragment.
 * Opcje proporcji: swobodne, 1:1, 4:3, 16:9, 3:4, 9:16.
 */
(function () {
  'use strict';

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var sourceImg        = null;
  var originalFileName = null;
  var displayScale     = 1;
  var cropRect         = null;   /* {x,y,w,h} w pikselach obrazu */
  var isDrawing        = false;
  var drawStart        = null;
  var aspectRatio      = null;   /* null = swobodne, lub np. 16/9 */
  var targetFmt        = 'image/jpeg';
  var targetExt        = 'jpg';
  var errorBox         = null;

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone      = document.getElementById('dropzone');
  var picker        = document.getElementById('picker');
  var workspace     = document.getElementById('workspace');
  var imgCanvas     = document.getElementById('imgCanvas');
  var overlayCanvas = document.getElementById('overlayCanvas');
  var btnReset      = document.getElementById('btnReset');
  var btnChangeFile = document.getElementById('btnChangeFile');
  var btnSave       = document.getElementById('btnSave');
  var saveInfo      = document.getElementById('saveInfo');
  var cropMeta      = document.getElementById('cropMeta');

  var imgCtx     = imgCanvas.getContext('2d');
  var overlayCtx = overlayCanvas.getContext('2d');

  /* ── Proporcje ────────────────────────────────────────────────────── */
  document.querySelectorAll('[data-ratio]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-ratio]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var r = btn.dataset.ratio;
      if (r === 'free') {
        aspectRatio = null;
      } else {
        var parts = r.split(':');
        aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
      }
      cropRect = null;
      renderOverlay();
      btnSave.disabled = true;
    });
  });

  /* ── Format ───────────────────────────────────────────────────────── */
  document.querySelectorAll('[data-fmt]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-fmt]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      targetFmt = btn.dataset.fmt;
      targetExt = btn.dataset.ext;
    });
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

  btnReset.addEventListener('click', function () {
    cropRect = null; renderOverlay(); btnSave.disabled = true;
    cropMeta.textContent = '';
  });
  btnChangeFile.addEventListener('click', function () { picker.click(); });
  btnSave.addEventListener('click', saveCrop);

  /* ── Obsługa pliku ────────────────────────────────────────────────── */
  function handleFiles(files) {
    var img = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/')) { img = files[i]; break; }
    }
    if (!img) { showError('Dodaj plik graficzny (JPG, PNG, WebP).'); return; }
    loadImage(img);
  }

  function loadImage(file) {
    originalFileName = file.name;
    cropRect = null;
    btnSave.disabled = true;
    saveInfo.textContent = '';
    cropMeta.textContent = '';

    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      sourceImg = img;
      URL.revokeObjectURL(url);
      dropzone.style.display = 'none';
      workspace.hidden = false;
      renderImage();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      showError('Nie udało się wczytać obrazu.');
    };
    img.src = url;
  }

  /* ── Renderowanie obrazu ──────────────────────────────────────────── */
  function renderImage() {
    var maxW = Math.min((imgCanvas.parentElement || document.body).clientWidth || 860, 860);
    displayScale = Math.min(maxW / sourceImg.naturalWidth, 1);

    var dw = Math.round(sourceImg.naturalWidth  * displayScale);
    var dh = Math.round(sourceImg.naturalHeight * displayScale);

    imgCanvas.width      = dw; imgCanvas.height      = dh;
    overlayCanvas.width  = dw; overlayCanvas.height  = dh;

    imgCtx.clearRect(0, 0, dw, dh);
    imgCtx.drawImage(sourceImg, 0, 0, dw, dh);
    renderOverlay();
  }

  /* ── Overlay ──────────────────────────────────────────────────────── */
  function renderOverlay(previewPx) {
    var w = overlayCanvas.width;
    var h = overlayCanvas.height;
    overlayCtx.clearRect(0, 0, w, h);

    var rect = previewPx || (cropRect ? imgToCanvas(cropRect) : null);
    if (!rect || rect.w < 2 || rect.h < 2) return;

    /* Przyciemnij poza zaznaczeniem */
    overlayCtx.fillStyle = 'rgba(0,0,0,0.52)';
    overlayCtx.fillRect(0, 0, w, h);
    overlayCtx.clearRect(rect.x, rect.y, rect.w, rect.h);

    /* Obramowanie */
    overlayCtx.strokeStyle = '#0B6951';
    overlayCtx.lineWidth   = 2;
    overlayCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    /* Siatka 3x3 */
    overlayCtx.strokeStyle = 'rgba(255,255,255,0.35)';
    overlayCtx.lineWidth   = 1;
    for (var i = 1; i < 3; i++) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(rect.x + rect.w * i / 3, rect.y);
      overlayCtx.lineTo(rect.x + rect.w * i / 3, rect.y + rect.h);
      overlayCtx.stroke();
      overlayCtx.beginPath();
      overlayCtx.moveTo(rect.x, rect.y + rect.h * i / 3);
      overlayCtx.lineTo(rect.x + rect.w, rect.y + rect.h * i / 3);
      overlayCtx.stroke();
    }
  }

  /* ── Konwersja współrzędnych ───────────────────────────────────────── */
  function imgToCanvas(r) {
    return { x: r.x * displayScale, y: r.y * displayScale,
             w: r.w * displayScale, h: r.h * displayScale };
  }

  function canvasToImg(cx, cy, cw, ch) {
    return { x: Math.round(cx / displayScale), y: Math.round(cy / displayScale),
             w: Math.round(cw / displayScale), h: Math.round(ch / displayScale) };
  }

  /* ── Rysowanie myszką ─────────────────────────────────────────────── */
  overlayCanvas.addEventListener('mousedown', function (e) {
    isDrawing = true; drawStart = getPos(e);
  });
  overlayCanvas.addEventListener('mousemove', function (e) {
    if (!isDrawing) return;
    renderOverlay(makeCanvasRect(drawStart, getPos(e)));
  });
  overlayCanvas.addEventListener('mouseup', function (e) {
    if (!isDrawing) return;
    isDrawing = false; commitRect(drawStart, getPos(e));
  });
  overlayCanvas.addEventListener('mouseleave', function () {
    if (!isDrawing) return;
    isDrawing = false; renderOverlay();
  });

  overlayCanvas.addEventListener('touchstart', function (e) {
    e.preventDefault(); isDrawing = true; drawStart = getPos(e.touches[0]);
  }, { passive: false });
  overlayCanvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (!isDrawing) return;
    renderOverlay(makeCanvasRect(drawStart, getPos(e.touches[0])));
  }, { passive: false });
  overlayCanvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    if (!isDrawing) return;
    isDrawing = false; commitRect(drawStart, getPos(e.changedTouches[0]));
  }, { passive: false });

  function makeCanvasRect(start, cur) {
    var cx = Math.min(start.x, cur.x);
    var cy = Math.min(start.y, cur.y);
    var cw = Math.abs(cur.x - start.x);
    var ch = Math.abs(cur.y - start.y);

    if (aspectRatio) {
      var fromW = cw;
      var fromH = cw / aspectRatio;
      if (fromH > ch) { fromH = ch; fromW = ch * aspectRatio; }
      cw = fromW; ch = fromH;
      /* zachowaj kierunek */
      if (cur.x < start.x) cx = start.x - cw;
      if (cur.y < start.y) cy = start.y - ch;
    }

    return { x: cx, y: cy, w: cw, h: ch };
  }

  function commitRect(start, cur) {
    var r = makeCanvasRect(start, cur);
    if (r.w < 5 || r.h < 5) { renderOverlay(); return; }

    /* Ogranicz do granic canvasu */
    r.x = Math.max(0, r.x); r.y = Math.max(0, r.y);
    r.w = Math.min(r.w, overlayCanvas.width  - r.x);
    r.h = Math.min(r.h, overlayCanvas.height - r.y);

    cropRect = canvasToImg(r.x, r.y, r.w, r.h);
    renderOverlay();
    updateMeta();
    btnSave.disabled = false;
  }

  function getPos(e) {
    var rect = overlayCanvas.getBoundingClientRect();
    var sx = overlayCanvas.width  / rect.width;
    var sy = overlayCanvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function updateMeta() {
    if (!cropRect) { cropMeta.textContent = ''; return; }
    cropMeta.textContent = cropRect.w + ' × ' + cropRect.h + ' px';
  }

  /* ── Zapis ────────────────────────────────────────────────────────── */
  function saveCrop() {
    if (!cropRect || !sourceImg) return;
    var r = cropRect;
    var tmp = document.createElement('canvas');
    tmp.width  = r.w;
    tmp.height = r.h;
    var ctx = tmp.getContext('2d');

    if (targetFmt === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, r.w, r.h);
    }
    ctx.drawImage(sourceImg, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);

    var q = (targetFmt === 'image/png') ? undefined : 0.92;
    tmp.toBlob(function (blob) {
      if (!blob) { saveInfo.textContent = 'Błąd zapisu.'; return; }
      var dot  = originalFileName ? originalFileName.lastIndexOf('.') : -1;
      var base = (dot !== -1) ? originalFileName.substring(0, dot) : (originalFileName || 'obraz');
      downloadBlob(blob, base + '-crop.' + targetExt);
      saveInfo.textContent = 'Pobrano · ' + r.w + ' × ' + r.h + ' px';
    }, targetFmt, q);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
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

  function escHtml(str) {
    return String(str).replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
