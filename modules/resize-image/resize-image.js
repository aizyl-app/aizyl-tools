/**
 * resize-image.js – Zmiana rozmiaru obrazów
 * Canvas API: draw scaled → toBlob.
 * Tryb: procent lub piksele (z zachowaniem proporcji).
 * Wiele plików → ZIP. Wszystko lokalnie.
 */
(function () {
  'use strict';

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var images    = [];
  var idCounter = 0;
  var mode      = 'percent';
  var targetFmt = 'image/jpeg';
  var targetExt = 'jpg';

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var wsCount      = document.getElementById('wsCount');
  var imgGrid      = document.getElementById('imgGrid');
  var btnAddMore   = document.getElementById('btnAddMore');
  var btnClear     = document.getElementById('btnClear');
  var btnResize    = document.getElementById('btnResize');
  var resizeInfo   = document.getElementById('resizeInfo');
  var imgCardTpl   = document.getElementById('imgCardTpl');
  var percentVal   = document.getElementById('percentVal');
  var percentDisp  = document.getElementById('percentDisplay');
  var percentInputs = document.getElementById('percentInputs');
  var pixelInputs  = document.getElementById('pixelInputs');
  var pxWidth      = document.getElementById('pxWidth');
  var pxHeight     = document.getElementById('pxHeight');
  var keepAspect   = document.getElementById('keepAspect');
  var errorsList   = null;

  /* ── Tryb ─────────────────────────────────────────────────────────── */
  document.querySelectorAll('[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      mode = btn.dataset.mode;
      percentInputs.style.display = (mode === 'percent') ? 'flex' : 'none';
      pixelInputs.style.display   = (mode === 'pixels')  ? 'flex' : 'none';
    });
  });

  percentVal.addEventListener('input', function () {
    percentDisp.textContent = percentVal.value;
  });

  /* Zachowanie proporcji przy wpisywaniu px */
  pxWidth.addEventListener('input', function () {
    if (!keepAspect.checked || images.length === 0) return;
    var first = images[0];
    if (!first.nw) return;
    var ratio = first.nh / first.nw;
    var w = parseInt(pxWidth.value, 10);
    if (w > 0) pxHeight.value = Math.round(w * ratio);
  });
  pxHeight.addEventListener('input', function () {
    if (!keepAspect.checked || images.length === 0) return;
    var first = images[0];
    if (!first.nw) return;
    var ratio = first.nw / first.nh;
    var h = parseInt(pxHeight.value, 10);
    if (h > 0) pxWidth.value = Math.round(h * ratio);
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

  btnAddMore.addEventListener('click', function () { picker.click(); });
  btnClear.addEventListener('click', clearAll);
  btnResize.addEventListener('click', resizeAll);

  /* ── Obsługa plików ───────────────────────────────────────────────── */
  function handleFiles(files) {
    files.forEach(function (f) {
      if (!f.type.startsWith('image/')) {
        showError(f.name, 'Nieobsługiwany format.'); return;
      }
      loadImage(f);
    });
  }

  function loadImage(file) {
    var url = URL.createObjectURL(file);
    var entry = {
      id:       'r' + (++idCounter),
      fileName: file.name,
      dataUrl:  url,
      nw: 0, nh: 0,
      el: null
    };

    var img = new Image();
    img.onload = function () {
      entry.nw = img.naturalWidth;
      entry.nh = img.naturalHeight;
      if (entry.el) {
        var dimsEl = entry.el.querySelector('.ic-dims');
        dimsEl.textContent = entry.nw + ' × ' + entry.nh + ' px';
      }
    };
    img.src = url;

    images.push(entry);
    var card = createCard(entry);
    entry.el = card;
    imgGrid.appendChild(card);
    updateWorkspace();
  }

  /* ── Karta ────────────────────────────────────────────────────────── */
  function createCard(entry) {
    var frag = imgCardTpl.content.cloneNode(true);
    var card = frag.querySelector('.img-card');
    card.dataset.id = entry.id;

    var imgEl  = card.querySelector('.ic-img');
    var nameEl = card.querySelector('.ic-name');
    var dimsEl = card.querySelector('.ic-dims');
    var delBtn = card.querySelector('.ic-del');

    imgEl.src = entry.dataUrl;
    imgEl.alt = entry.fileName;
    nameEl.textContent = entry.fileName;
    dimsEl.textContent = '…';

    delBtn.addEventListener('click', function () { removeImage(entry.id); });
    return card;
  }

  function removeImage(id) {
    var idx = indexById(id);
    if (idx === -1) return;
    URL.revokeObjectURL(images[idx].dataUrl);
    if (images[idx].el) images[idx].el.remove();
    images.splice(idx, 1);
    updateWorkspace();
  }

  function clearAll() {
    images.forEach(function (e) { URL.revokeObjectURL(e.dataUrl); });
    images = [];
    imgGrid.innerHTML = '';
    if (errorsList) errorsList.innerHTML = '';
    resizeInfo.textContent = '';
    updateWorkspace();
  }

  function indexById(id) {
    for (var i = 0; i < images.length; i++) { if (images[i].id === id) return i; }
    return -1;
  }

  function updateWorkspace() {
    if (images.length === 0) { workspace.hidden = true; return; }
    workspace.hidden = false;
    wsCount.textContent = images.length + ' ' +
      pluralStr(images.length, 'obraz', 'obrazy', 'obrazów');
  }

  /* ── Resize ───────────────────────────────────────────────────────── */
  function getTargetDims(entry) {
    if (mode === 'percent') {
      var pct = parseFloat(percentVal.value) / 100;
      return { w: Math.round(entry.nw * pct), h: Math.round(entry.nh * pct) };
    }
    /* tryb piksele */
    var tw = parseInt(pxWidth.value, 10);
    var th = parseInt(pxHeight.value, 10);
    if (!tw && !th) return { w: entry.nw, h: entry.nh };
    if (keepAspect.checked) {
      if (tw && !th) { th = Math.round(tw * entry.nh / entry.nw); }
      else if (th && !tw) { tw = Math.round(th * entry.nw / entry.nh); }
      else {
        var scale = Math.min(tw / entry.nw, th / entry.nh);
        tw = Math.round(entry.nw * scale);
        th = Math.round(entry.nh * scale);
      }
    }
    return { w: tw || entry.nw, h: th || entry.nh };
  }

  function resizeAll() {
    if (images.length === 0) return;
    btnResize.disabled = true;
    resizeInfo.textContent = 'Przeliczam…';
    var total = images.length;
    var done  = 0;

    setTimeout(function () {
      var results = [];

      function next(i) {
        if (i >= images.length) { finish(results); return; }
        resizeOne(images[i], function (blob) {
          if (blob) {
            var base = stripExt(images[i].fileName);
            results.push({ blob: blob, name: base + '-' + targetExt + '.' + targetExt });
          }
          done++;
          resizeInfo.textContent = done + ' / ' + total;
          next(i + 1);
        });
      }
      next(0);
    }, 0);
  }

  function resizeOne(entry, cb) {
    var img = new Image();
    img.onload = function () {
      setTimeout(function () {
        var dims = getTargetDims(entry);
        var c = document.createElement('canvas');
        c.width  = dims.w;
        c.height = dims.h;
        var ctx = c.getContext('2d');
        if (targetFmt === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
        }
        ctx.drawImage(img, 0, 0, dims.w, dims.h);
        var q = (targetFmt === 'image/png') ? undefined : 0.92;
        c.toBlob(function (blob) { cb(blob); }, targetFmt, q);
      }, 0);
    };
    img.onerror = function () { cb(null); };
    img.src = entry.dataUrl;
  }

  function finish(results) {
    if (results.length === 0) {
      resizeInfo.textContent = 'Błąd zmiany rozmiaru.';
      btnResize.disabled = false;
      return;
    }
    if (results.length === 1) {
      downloadBlob(results[0].blob, results[0].name);
      resizeInfo.textContent = 'Pobrano · ' + results[0].name;
      btnResize.disabled = false;
      return;
    }
    resizeInfo.textContent = 'Pakuję ZIP…';
    var JSZip = window.JSZip;
    if (!JSZip) {
      results.forEach(function (r) { downloadBlob(r.blob, r.name); });
      resizeInfo.textContent = 'Pobrano ' + results.length + ' pliki.';
      btnResize.disabled = false;
      return;
    }
    var zip = new JSZip();
    var folder = zip.folder('przeskalowane');
    results.forEach(function (r) { folder.file(r.name, r.blob); });
    zip.generateAsync({ type: 'blob' }).then(function (zipBlob) {
      downloadBlob(zipBlob, 'przeskalowane.zip');
      resizeInfo.textContent = 'Pobrano ZIP · ' + results.length + ' pliki';
      btnResize.disabled = false;
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
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

  function stripExt(name) {
    var dot = name.lastIndexOf('.');
    return dot !== -1 ? name.substring(0, dot) : name;
  }

  function pluralStr(n, one, few, many) {
    if (n === 1) return one; if (n >= 2 && n <= 4) return few; return many;
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
