/**
 * scan.js – Skanowanie dokumentów kamerą do PDF
 * getUserMedia → video → canvas → pdf-lib (embedJpg).
 * Wszystko lokalnie, żadne dane nie opuszczają przeglądarki.
 */
(function () {
  'use strict';

  var A4_W = 595.28;
  var A4_H = 841.89;

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var stream      = null;
  var facingMode  = 'environment';
  var shots       = [];
  var idCounter   = 0;

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var camVideo    = document.getElementById('camVideo');
  var camCanvas   = document.getElementById('camCanvas');
  var camOverlay  = document.getElementById('camOverlay');
  var camOffText  = document.getElementById('camOffText');
  var camControls = document.getElementById('camControls');
  var btnStartCam = document.getElementById('btnStartCam');
  var btnShoot    = document.getElementById('btnShoot');
  var btnFlip     = document.getElementById('btnFlip');
  var btnStopCam  = document.getElementById('btnStopCam');
  var workspace   = document.getElementById('workspace');
  var wsCount     = document.getElementById('wsCount');
  var pageGrid    = document.getElementById('pageGrid');
  var btnClear    = document.getElementById('btnClear');
  var btnSave     = document.getElementById('btnSave');
  var saveInfo    = document.getElementById('saveInfo');
  var imgTpl      = document.getElementById('imgTpl');

  /* ── Kamera ───────────────────────────────────────────────────────── */
  btnStartCam.addEventListener('click', startCamera);
  btnStopCam.addEventListener('click', stopCamera);
  btnFlip.addEventListener('click', flipCamera);
  btnShoot.addEventListener('click', shoot);
  btnClear.addEventListener('click', clearAll);
  btnSave.addEventListener('click', savePDF);

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCamError('Twoja przeglądarka nie obsługuje dostępu do kamery.');
      return;
    }

    var constraints = {
      video: {
        facingMode: facingMode,
        width:  { ideal: 1920 },
        height: { ideal: 1080 }
      }
    };

    navigator.mediaDevices.getUserMedia(constraints).then(function (s) {
      stream = s;
      camVideo.srcObject = s;
      camOverlay.style.display = 'none';
      camControls.hidden = false;
    }).catch(function (err) {
      var msg = err.name === 'NotAllowedError'
        ? 'Brak dostępu do kamery. Zezwól na dostęp w ustawieniach przeglądarki.'
        : err.name === 'NotFoundError'
        ? 'Nie znaleziono kamery. Podłącz kamerę i spróbuj ponownie.'
        : 'Nie udało się uruchomić kamery: ' + err.message;
      showCamError(msg);
    });
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    camVideo.srcObject = null;
    camOverlay.style.display = 'flex';
    camOffText.textContent = 'Kamera zatrzymana';
    btnStartCam.textContent = '';
    btnStartCam.innerHTML = '<span class="ti ti-camera"></span> Uruchom kamerę';
    camControls.hidden = true;
  }

  function flipCamera() {
    facingMode = (facingMode === 'environment') ? 'user' : 'environment';
    stopCamera();
    startCamera();
  }

  function showCamError(msg) {
    camOffText.textContent = msg;
    camOverlay.style.display = 'flex';
    camControls.hidden = true;
  }

  /* ── Zdjęcie ──────────────────────────────────────────────────────── */
  function shoot() {
    if (!stream) return;

    var vw = camVideo.videoWidth  || 1280;
    var vh = camVideo.videoHeight || 720;

    camCanvas.width  = vw;
    camCanvas.height = vh;
    var ctx = camCanvas.getContext('2d');
    ctx.drawImage(camVideo, 0, 0, vw, vh);

    var dataUrl = camCanvas.toDataURL('image/jpeg', 0.92);

    /* Pobierz bajty do pdf-lib */
    var b64  = dataUrl.split(',')[1];
    var raw  = atob(b64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    var entry = {
      id:      's' + (++idCounter),
      dataUrl: dataUrl,
      bytes:   bytes,
      w:       vw,
      h:       vh,
      el:      null
    };

    shots.push(entry);
    var card = createCard(entry);
    entry.el = card;
    pageGrid.appendChild(card);
    updateWorkspace();

    /* Krótka animacja mignięcia */
    camVideo.style.opacity = '0.3';
    setTimeout(function () { camVideo.style.opacity = '1'; }, 120);
  }

  /* ── Karta zdjęcia ────────────────────────────────────────────────── */
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
    imgEl.alt = 'Skan ' + shots.length;

    updateCardMeta(card, entry);

    btnDel.addEventListener('click', function (e) {
      e.stopPropagation(); removeShot(entry.id);
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
    var idx   = shots.indexOf(entry);
    var numEl = card.querySelector('.pc-num');
    var posIn = card.querySelector('.pc-pos-input');
    var btnL  = card.querySelector('.pc-move-left');
    var btnR  = card.querySelector('.pc-move-right');
    numEl.textContent = 'Str. ' + (idx + 1);
    posIn.value = idx + 1;
    posIn.max   = shots.length;
    btnL.disabled = (idx === 0);
    btnR.disabled = (idx === shots.length - 1);
  }

  /* ── Drag-and-drop ────────────────────────────────────────────────── */
  var dragSrcId = null;

  function onDragStart(e) {
    dragSrcId = this.dataset.id; this.classList.add('dragging');
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
  function removeShot(id) {
    var idx = indexById(id);
    if (idx === -1) return;
    if (shots[idx].el) shots[idx].el.remove();
    shots.splice(idx, 1);
    updateWorkspace();
  }

  function moveBy(id, delta) {
    var idx = indexById(id);
    var nxt = idx + delta;
    if (nxt < 0 || nxt >= shots.length) return;
    swapByIdx(idx, nxt);
  }

  function moveTo(id, target) {
    var idx = indexById(id);
    if (idx === -1) return;
    target = Math.max(0, Math.min(shots.length - 1, target));
    if (idx === target) { updateWorkspace(); return; }
    var entry = shots.splice(idx, 1)[0];
    shots.splice(target, 0, entry);
    rebuildGrid();
    updateWorkspace();
  }

  function swapById(idA, idB) { swapByIdx(indexById(idA), indexById(idB)); }
  function swapByIdx(iA, iB) {
    var tmp = shots[iA]; shots[iA] = shots[iB]; shots[iB] = tmp;
    rebuildGrid(); updateWorkspace();
  }
  function rebuildGrid() {
    shots.forEach(function (e) { if (e.el) pageGrid.appendChild(e.el); });
  }
  function indexById(id) {
    for (var i = 0; i < shots.length; i++) { if (shots[i].id === id) return i; }
    return -1;
  }
  function clearAll() {
    shots = []; pageGrid.innerHTML = '';
    updateWorkspace();
  }

  /* ── UI ───────────────────────────────────────────────────────────── */
  function updateWorkspace() {
    if (shots.length === 0) { workspace.hidden = true; return; }
    workspace.hidden = false;
    wsCount.textContent = shots.length + ' ' +
      pluralStr(shots.length, 'zdjęcie', 'zdjęcia', 'zdjęć');
    shots.forEach(function (e) { if (e.el) updateCardMeta(e.el, e); });
  }

  /* ── Zapis PDF ────────────────────────────────────────────────────── */
  function getPageSize() {
    var sel = document.querySelector('input[name="pageSize"]:checked');
    return sel ? sel.value : 'fit';
  }

  function savePDF() {
    if (shots.length === 0) return;
    var PDFLib = window.PDFLib;
    if (!PDFLib) { saveInfo.textContent = 'Błąd: pdf-lib niedostępna.'; return; }

    var pageSize = getPageSize();
    var total    = shots.length;
    var done     = 0;

    btnSave.disabled = true;
    saveInfo.textContent = 'Tworzę PDF…';

    setTimeout(function () {
      PDFLib.PDFDocument.create().then(function (doc) {
        return shots.reduce(function (chain, entry) {
          return chain.then(function () {
            return doc.embedJpg(entry.bytes).then(function (img) {
              var iw = entry.w;
              var ih = entry.h;
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
              page.drawImage(img, { x: x, y: y, width: dw, height: dh });
              done++;
              saveInfo.textContent = done + ' / ' + total;
            });
          });
        }, Promise.resolve()).then(function () { return doc; });
      }).then(function (doc) {
        saveInfo.textContent = 'Zapisuję plik…';
        return doc.save();
      }).then(function (bytes) {
        var now  = new Date();
        var name = 'skan-' + now.getFullYear() + '-' +
          pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '.pdf';
        downloadBytes(bytes, name);
        saveInfo.textContent = 'Pobrano · ' + total + ' ' +
          pluralStr(total, 'strona', 'strony', 'stron');
        btnSave.disabled = false;
      }).catch(function (err) {
        saveInfo.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany');
        btnSave.disabled = false;
      });
    }, 0);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function pluralStr(n, one, few, many) {
    if (n === 1) return one; if (n >= 2 && n <= 4) return few; return many;
  }

})();
