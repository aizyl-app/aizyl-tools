/**
 * image-to-pdf.js – Konwersja obrazów do PDF
 * Każdy obraz staje się jedną stroną. Drag-and-drop kolejności.
 * pdf-lib do składania wyniku. Wszystko lokalnie.
 */
(function () {
  'use strict';

  /* ── Stałe ────────────────────────────────────────────────────────── */
  var A4_W = 595.28;
  var A4_H = 841.89;

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var images = [];
  var idCounter = 0;

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone    = document.getElementById('dropzone');
  var picker      = document.getElementById('picker');
  var workspace   = document.getElementById('workspace');
  var wsCount     = document.getElementById('wsCount');
  var pageGrid    = document.getElementById('pageGrid');
  var btnAddMore  = document.getElementById('btnAddMore');
  var btnClear    = document.getElementById('btnClear');
  var btnConvert  = document.getElementById('btnConvert');
  var convertInfo = document.getElementById('convertInfo');
  var imgTpl      = document.getElementById('imgTpl');
  var errorsList  = null;

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
  btnConvert.addEventListener('click', convertToPDF);

  /* ── Obsługa plików ───────────────────────────────────────────────── */
  var ACCEPTED = ['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/bmp','image/avif'];

  function handleFiles(files) {
    var imgs = [];
    var bad  = [];
    files.forEach(function (f) {
      if (ACCEPTED.indexOf(f.type) !== -1 || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)) {
        imgs.push(f);
      } else {
        bad.push(f.name);
      }
    });
    bad.forEach(function (name) {
      showError(name, 'Nieobsługiwany format. Dodaj JPG, PNG, WebP, GIF lub BMP.');
    });
    if (imgs.length === 0) return;
    imgs.forEach(function (f) { loadImage(f); });
  }

  function loadImage(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var dataUrl = e.target.result;
      var entry = {
        id:       'i' + (++idCounter),
        fileName: file.name,
        dataUrl:  dataUrl,
        type:     file.type || detectType(file.name),
        bytes:    null,
        el:       null
      };

      /* Zapamiętaj bajty do osadzenia w pdf-lib */
      var reader2 = new FileReader();
      reader2.onload = function (e2) {
        entry.bytes = new Uint8Array(e2.target.result);
      };
      reader2.readAsArrayBuffer(file);

      images.push(entry);
      var card = createCard(entry);
      entry.el = card;
      pageGrid.appendChild(card);
      updateWorkspace();
    };
    reader.readAsDataURL(file);
  }

  function detectType(name) {
    var ext = name.split('.').pop().toLowerCase();
    var map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' };
    return map[ext] || 'image/jpeg';
  }

  /* ── Karta obrazu ─────────────────────────────────────────────────── */
  function createCard(entry) {
    var frag = imgTpl.content.cloneNode(true);
    var card = frag.querySelector('.page-card');
    card.dataset.id = entry.id;
    card.setAttribute('tabindex', '0');

    var imgEl  = card.querySelector('.pc-img');
    var posIn  = card.querySelector('.pc-pos-input');
    var btnDel = card.querySelector('.pc-delete');
    var btnL   = card.querySelector('.pc-move-left');
    var btnR   = card.querySelector('.pc-move-right');

    imgEl.src = entry.dataUrl;
    imgEl.alt = entry.fileName;

    updateCardMeta(card, entry);

    btnDel.addEventListener('click', function (e) {
      e.stopPropagation(); removeImage(entry.id);
    });
    btnL.addEventListener('click', function (e) {
      e.stopPropagation(); moveBy(entry.id, -1);
    });
    btnR.addEventListener('click', function (e) {
      e.stopPropagation(); moveBy(entry.id, +1);
    });
    posIn.addEventListener('change', function () {
      moveTo(entry.id, parseInt(posIn.value, 10) - 1);
    });
    posIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') posIn.blur();
    });

    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragover',  onDragOver);
    card.addEventListener('dragleave', onDragLeave);
    card.addEventListener('drop',      onDrop);
    card.addEventListener('dragend',   onDragEnd);

    return card;
  }

  function updateCardMeta(card, entry) {
    var idx   = images.indexOf(entry);
    var numEl = card.querySelector('.pc-num');
    var srcEl = card.querySelector('.pc-src');
    var posIn = card.querySelector('.pc-pos-input');
    var btnL  = card.querySelector('.pc-move-left');
    var btnR  = card.querySelector('.pc-move-right');
    numEl.textContent = 'Str. ' + (idx + 1);
    srcEl.textContent = entry.fileName;
    posIn.value = idx + 1;
    posIn.max   = images.length;
    btnL.disabled = (idx === 0);
    btnR.disabled = (idx === images.length - 1);
  }

  /* ── Drag-and-drop kart ───────────────────────────────────────────── */
  var dragSrcId = null;

  function onDragStart(e) {
    dragSrcId = this.dataset.id;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (this.dataset.id !== dragSrcId) this.classList.add('drag-over');
  }
  function onDragLeave() { this.classList.remove('drag-over'); }
  function onDrop(e) {
    e.preventDefault(); this.classList.remove('drag-over');
    if (dragSrcId && this.dataset.id && dragSrcId !== this.dataset.id) {
      swapById(dragSrcId, this.dataset.id);
    }
  }
  function onDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.page-card.drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
    dragSrcId = null;
  }

  /* ── Operacje na liście ───────────────────────────────────────────── */
  function removeImage(id) {
    var idx = indexById(id);
    if (idx === -1) return;
    if (images[idx].el) images[idx].el.remove();
    images.splice(idx, 1);
    updateWorkspace();
  }

  function moveBy(id, delta) {
    var idx = indexById(id);
    var nxt = idx + delta;
    if (nxt < 0 || nxt >= images.length) return;
    swapByIdx(idx, nxt);
  }

  function moveTo(id, target) {
    var idx = indexById(id);
    if (idx === -1) return;
    target = Math.max(0, Math.min(images.length - 1, target));
    if (idx === target) { updateWorkspace(); return; }
    var entry = images.splice(idx, 1)[0];
    images.splice(target, 0, entry);
    rebuildGrid();
    updateWorkspace();
  }

  function swapById(idA, idB) { swapByIdx(indexById(idA), indexById(idB)); }

  function swapByIdx(iA, iB) {
    var tmp = images[iA]; images[iA] = images[iB]; images[iB] = tmp;
    rebuildGrid(); updateWorkspace();
  }

  function rebuildGrid() {
    images.forEach(function (e) { if (e.el) pageGrid.appendChild(e.el); });
  }

  function indexById(id) {
    for (var i = 0; i < images.length; i++) { if (images[i].id === id) return i; }
    return -1;
  }

  function clearAll() {
    images = [];
    pageGrid.innerHTML = '';
    if (errorsList) errorsList.innerHTML = '';
    updateWorkspace();
  }

  /* ── UI ───────────────────────────────────────────────────────────── */
  function updateWorkspace() {
    if (images.length === 0) { workspace.hidden = true; return; }
    workspace.hidden = false;
    wsCount.textContent = images.length + ' ' +
      pluralStr(images.length, 'obraz', 'obrazy', 'obrazów');
    images.forEach(function (e) { if (e.el) updateCardMeta(e.el, e); });
  }

  /* ── Konwersja do PDF ─────────────────────────────────────────────── */
  function getPageSize() {
    var sel = document.querySelector('input[name="pageSize"]:checked');
    return sel ? sel.value : 'fit';
  }

  function convertToPDF() {
    if (images.length === 0) return;
    var PDFLib = window.PDFLib;
    if (!PDFLib) { convertInfo.textContent = 'Błąd: pdf-lib niedostępna.'; return; }

    btnConvert.disabled = true;
    convertInfo.textContent = 'Przygotowuję…';

    var pageSize = getPageSize();
    var total = images.length;
    var done = 0;

    /* setTimeout(0) oddaje wątek przeglądarce żeby zdążyła wyrenderować
       nowy stan przycisku zanim zacznie się ciężka praca */
    setTimeout(function () {
      PDFLib.PDFDocument.create().then(function (doc) {
        return images.reduce(function (chain, entry) {
          return chain.then(function () {
            return embedImage(doc, entry, PDFLib).then(function (result) {
              addPage(doc, result, pageSize, PDFLib);
              done++;
              convertInfo.textContent = done + ' / ' + total;
            });
          });
        }, Promise.resolve()).then(function () { return doc; });
      }).then(function (doc) {
        convertInfo.textContent = 'Zapisuję plik…';
        return doc.save();
      }).then(function (bytes) {
        downloadBytes(bytes, 'obrazy.pdf');
        convertInfo.textContent = 'Pobrano · ' + total + ' ' +
          pluralStr(total, 'strona', 'strony', 'stron');
        btnConvert.disabled = false;
      }).catch(function (err) {
        convertInfo.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany');
        btnConvert.disabled = false;
      });
    }, 0);
  }

  /**
   * Osadza obraz w dokumencie pdf-lib.
   * JPEG/PNG → bezpośrednio. Pozostałe → canvas → JPEG.
   */
  function embedImage(doc, entry, PDFLib) {
    var type = entry.type;
    if (type === 'image/jpeg' || type === 'image/jpg') {
      return waitForBytes(entry).then(function (b) { return doc.embedJpg(b); }).then(function (img) {
        return { img: img, nw: img.width, nh: img.height };
      });
    }
    if (type === 'image/png') {
      return waitForBytes(entry).then(function (b) { return doc.embedPng(b); }).then(function (img) {
        return { img: img, nw: img.width, nh: img.height };
      });
    }
    /* Pozostałe formaty: konwertuj przez canvas do JPEG */
    return canvasToJpeg(entry.dataUrl).then(function (data) {
      return doc.embedJpg(data.bytes).then(function (img) {
        return { img: img, nw: data.w, nh: data.h };
      });
    });
  }

  function waitForBytes(entry) {
    return new Promise(function (resolve) {
      var check = function () {
        if (entry.bytes) { resolve(entry.bytes); }
        else { setTimeout(check, 20); }
      };
      check();
    });
  }

  function canvasToJpeg(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        /* setTimeout(0) przed toDataURL oddaje wątek przeglądarce
           między przetwarzaniem kolejnych obrazów */
        setTimeout(function () {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          var jpegUrl = c.toDataURL('image/jpeg', 0.92);
          var b64 = jpegUrl.split(',')[1];
          var raw = atob(b64);
          var bytes = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          resolve({ bytes: bytes, w: img.naturalWidth, h: img.naturalHeight });
        }, 0);
      };
      img.src = dataUrl;
    });
  }

  function addPage(doc, result, pageSize, PDFLib) {
    var iw = result.nw;
    var ih = result.nh;
    var pw, ph, x, y, dw, dh;

    if (pageSize === 'fit') {
      pw = iw; ph = ih; x = 0; y = 0; dw = iw; dh = ih;
    } else {
      pw = (pageSize === 'a4') ? A4_W : A4_H;
      ph = (pageSize === 'a4') ? A4_H : A4_W;
      var scale = Math.min(pw / iw, ph / ih);
      dw = iw * scale; dh = ih * scale;
      x = (pw - dw) / 2; y = (ph - dh) / 2;
    }

    var page = doc.addPage([pw, ph]);
    page.drawImage(result.img, { x: x, y: y, width: dw, height: dh });
  }

  /* ── Pobieranie ───────────────────────────────────────────────────── */
  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
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
    item.querySelector('.file-error-close').addEventListener('click', function () {
      item.remove();
    });
    list.appendChild(item);
  }

  /* ── Pomocnicze ───────────────────────────────────────────────────── */
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
