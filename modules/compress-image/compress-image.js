/**
 * compress-image.js – Kompresja obrazów
 * Canvas API: draw → toBlob(format, quality).
 * Pokazuje rozmiar przed i po. Wiele plików → ZIP.
 */
(function () {
  'use strict';

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var images    = [];
  var idCounter = 0;
  var targetFmt = 'image/jpeg';
  var targetExt = 'jpg';
  var quality   = 0.82;

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var wsCount      = document.getElementById('wsCount');
  var imgGrid      = document.getElementById('imgGrid');
  var btnAddMore   = document.getElementById('btnAddMore');
  var btnClear     = document.getElementById('btnClear');
  var btnCompress  = document.getElementById('btnCompress');
  var compressInfo = document.getElementById('compressInfo');
  var qualityRange = document.getElementById('qualityRange');
  var qualityVal   = document.getElementById('qualityVal');
  var imgCardTpl   = document.getElementById('imgCardTpl');
  var errorsList   = null;

  /* ── Format ───────────────────────────────────────────────────────── */
  document.querySelectorAll('.fmt-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.fmt-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      targetFmt = btn.dataset.fmt;
      targetExt = btn.dataset.ext;
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
  btnCompress.addEventListener('click', compressAll);

  /* ── Obsługa plików ───────────────────────────────────────────────── */
  function handleFiles(files) {
    files.forEach(function (f) {
      if (!f.type.startsWith('image/')) {
        showError(f.name, 'Nieobsługiwany format. Dodaj plik graficzny.');
        return;
      }
      loadImage(f);
    });
  }

  function loadImage(file) {
    var url = URL.createObjectURL(file);
    var entry = {
      id:       'ci' + (++idCounter),
      fileName: file.name,
      origSize: file.size,
      dataUrl:  url,
      newSize:  null,
      el:       null
    };
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

    var imgEl   = card.querySelector('.ic-img');
    var nameEl  = card.querySelector('.ic-name');
    var origEl  = card.querySelector('.ic-orig');
    var newEl   = card.querySelector('.ic-new');
    var delBtn  = card.querySelector('.ic-del');

    imgEl.src = entry.dataUrl;
    imgEl.alt = entry.fileName;
    nameEl.textContent = entry.fileName;
    origEl.textContent = formatBytes(entry.origSize);
    newEl.textContent  = '—';

    delBtn.addEventListener('click', function () { removeImage(entry.id); });

    return card;
  }

  function updateCardNewSize(entry, size) {
    if (!entry.el) return;
    var newEl  = entry.el.querySelector('.ic-new');
    var origEl = entry.el.querySelector('.ic-orig');
    var pct    = Math.round((size / entry.origSize) * 100);
    newEl.textContent = formatBytes(size) + ' (' + pct + '%)';
    newEl.style.color = size < entry.origSize ? 'var(--primary)' : 'var(--danger)';
    origEl.style.textDecoration = 'line-through';
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
    compressInfo.textContent = '';
    updateWorkspace();
  }

  function indexById(id) {
    for (var i = 0; i < images.length; i++) { if (images[i].id === id) return i; }
    return -1;
  }

  /* ── UI ───────────────────────────────────────────────────────────── */
  function updateWorkspace() {
    if (images.length === 0) { workspace.hidden = true; return; }
    workspace.hidden = false;
    wsCount.textContent = images.length + ' ' +
      pluralStr(images.length, 'obraz', 'obrazy', 'obrazów');
  }

  /* ── Kompresja ────────────────────────────────────────────────────── */
  function compressAll() {
    if (images.length === 0) return;
    btnCompress.disabled = true;
    compressInfo.textContent = 'Kompresuję…';
    var total = images.length;
    var done  = 0;

    setTimeout(function () {
      var results = [];

      function next(i) {
        if (i >= images.length) { finish(results); return; }
        compressOne(images[i], function (blob) {
          if (blob) {
            images[i].newSize = blob.size;
            updateCardNewSize(images[i], blob.size);
            var base = stripExt(images[i].fileName);
            results.push({ blob: blob, name: base + '.' + targetExt });
          }
          done++;
          compressInfo.textContent = done + ' / ' + total;
          next(i + 1);
        });
      }
      next(0);
    }, 0);
  }

  function compressOne(entry, cb) {
    var img = new Image();
    img.onload = function () {
      setTimeout(function () {
        var c = document.createElement('canvas');
        c.width  = img.naturalWidth;
        c.height = img.naturalHeight;
        var ctx = c.getContext('2d');
        if (targetFmt === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
        }
        ctx.drawImage(img, 0, 0);
        c.toBlob(function (blob) { cb(blob); }, targetFmt, quality);
      }, 0);
    };
    img.onerror = function () { cb(null); };
    img.src = entry.dataUrl;
  }

  function finish(results) {
    if (results.length === 0) {
      compressInfo.textContent = 'Błąd kompresji.';
      btnCompress.disabled = false;
      return;
    }

    /* Podsumowanie oszczędności */
    var origTotal = images.reduce(function (s, e) { return s + e.origSize; }, 0);
    var newTotal  = results.reduce(function (s, r) { return s + r.blob.size; }, 0);
    var saved     = Math.round((1 - newTotal / origTotal) * 100);

    if (results.length === 1) {
      downloadBlob(results[0].blob, results[0].name);
      compressInfo.textContent = 'Pobrano · zaoszczędzono ' + saved + '%';
      btnCompress.disabled = false;
      return;
    }

    compressInfo.textContent = 'Pakuję ZIP…';
    var JSZip = window.JSZip;
    if (!JSZip) {
      results.forEach(function (r) { downloadBlob(r.blob, r.name); });
      compressInfo.textContent = 'Pobrano · zaoszczędzono ' + saved + '%';
      btnCompress.disabled = false;
      return;
    }

    var zip = new JSZip();
    var folder = zip.folder('skompresowane');
    results.forEach(function (r) { folder.file(r.name, r.blob); });
    zip.generateAsync({ type: 'blob' }).then(function (zipBlob) {
      downloadBlob(zipBlob, 'skompresowane.zip');
      compressInfo.textContent = 'Pobrano ZIP · zaoszczędzono ' + saved + '%';
      btnCompress.disabled = false;
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
