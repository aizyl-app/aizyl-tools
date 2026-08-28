/**
 * strip-exif.js – Usuwanie metadanych EXIF ze zdjęć
 * Canvas API: draw → toBlob (bez oryginalnych metadanych).
 * Wiele plików → ZIP. Wszystko lokalnie.
 */
(function () {
  'use strict';

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var images    = [];
  var idCounter = 0;
  var targetFmt = 'image/jpeg';
  var targetExt = 'jpg';

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone   = document.getElementById('dropzone');
  var picker     = document.getElementById('picker');
  var workspace  = document.getElementById('workspace');
  var wsCount    = document.getElementById('wsCount');
  var imgGrid    = document.getElementById('imgGrid');
  var btnAddMore = document.getElementById('btnAddMore');
  var btnClear   = document.getElementById('btnClear');
  var btnStrip   = document.getElementById('btnStrip');
  var stripInfo  = document.getElementById('stripInfo');
  var imgCardTpl = document.getElementById('imgCardTpl');
  var errorsList = null;

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
  btnStrip.addEventListener('click', stripAll);

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
      id:       'e' + (++idCounter),
      fileName: file.name,
      origSize: file.size,
      dataUrl:  url,
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

    var imgEl    = card.querySelector('.ic-img');
    var nameEl   = card.querySelector('.ic-name');
    var statusEl = card.querySelector('.ic-status');
    var delBtn   = card.querySelector('.ic-del');

    imgEl.src = entry.dataUrl;
    imgEl.alt = entry.fileName;
    nameEl.textContent   = entry.fileName;
    statusEl.textContent = formatBytes(entry.origSize);

    delBtn.addEventListener('click', function () { removeImage(entry.id); });
    return card;
  }

  function setCardDone(entry) {
    if (!entry.el) return;
    var statusEl = entry.el.querySelector('.ic-status');
    statusEl.textContent = 'EXIF usunięty';
    statusEl.style.color = 'var(--primary)';
    entry.el.classList.add('done');
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
    stripInfo.textContent = '';
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
      pluralStr(images.length, 'zdjęcie', 'zdjęcia', 'zdjęć');
  }

  /* ── Strip EXIF ───────────────────────────────────────────────────── */
  function stripAll() {
    if (images.length === 0) return;
    btnStrip.disabled = true;
    stripInfo.textContent = 'Czyszczę…';
    var total = images.length;
    var done  = 0;

    setTimeout(function () {
      var results = [];

      function next(i) {
        if (i >= images.length) { finish(results); return; }
        stripOne(images[i], function (blob) {
          if (blob) {
            setCardDone(images[i]);
            var base = stripExt(images[i].fileName);
            results.push({ blob: blob, name: base + '.' + targetExt });
          }
          done++;
          stripInfo.textContent = done + ' / ' + total;
          next(i + 1);
        });
      }
      next(0);
    }, 0);
  }

  function stripOne(entry, cb) {
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
        var q = (targetFmt === 'image/png') ? undefined : 0.95;
        c.toBlob(function (blob) { cb(blob); }, targetFmt, q);
      }, 0);
    };
    img.onerror = function () { cb(null); };
    img.src = entry.dataUrl;
  }

  function finish(results) {
    if (results.length === 0) {
      stripInfo.textContent = 'Błąd przetwarzania.';
      btnStrip.disabled = false;
      return;
    }

    if (results.length === 1) {
      downloadBlob(results[0].blob, results[0].name);
      stripInfo.textContent = 'Pobrano · EXIF usunięty';
      btnStrip.disabled = false;
      return;
    }

    stripInfo.textContent = 'Pakuję ZIP…';
    var JSZip = window.JSZip;
    if (!JSZip) {
      results.forEach(function (r) { downloadBlob(r.blob, r.name); });
      stripInfo.textContent = 'Pobrano ' + results.length + ' pliki.';
      btnStrip.disabled = false;
      return;
    }

    var zip = new JSZip();
    var folder = zip.folder('bez-exif');
    results.forEach(function (r) { folder.file(r.name, r.blob); });
    zip.generateAsync({ type: 'blob' }).then(function (zipBlob) {
      downloadBlob(zipBlob, 'bez-exif.zip');
      stripInfo.textContent = 'Pobrano ZIP · ' + results.length + ' ' +
        pluralStr(results.length, 'zdjęcie', 'zdjęcia', 'zdjęć');
      btnStrip.disabled = false;
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
