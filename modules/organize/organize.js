/**
 * organize.js – Organizowanie stron PDF
 * Zmiana kolejności, usuwanie, obracanie stron jednego dokumentu.
 * pdf.js (miniatury) + pdf-lib (wynik). Wszystko lokalnie.
 */
(function () {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var pages = [];
  var idCounter = 0;
  var originalBytes = null;
  var originalFileName = null;

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var loadProgress = document.getElementById('loadProgress');
  var lpFill       = document.getElementById('lpFill');
  var lpLabel      = document.getElementById('lpLabel');
  var workspace    = document.getElementById('workspace');
  var wsCount      = document.getElementById('wsCount');
  var pageGrid     = document.getElementById('pageGrid');
  var btnChange    = document.getElementById('btnChange');
  var btnClear     = document.getElementById('btnClear');
  var btnSave      = document.getElementById('btnSave');
  var organizeInfo = document.getElementById('organizeInfo');
  var pageTpl      = document.getElementById('pageTpl');
  var errorBox     = null;

  /* ── Drag-and-drop pliku ──────────────────────────────────────────── */
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
    handleFiles(Array.from(picker.files)); picker.value = '';
  });

  btnChange.addEventListener('click', function () { picker.click(); });
  btnClear.addEventListener('click', clearAll);
  btnSave.addEventListener('click', savePDF);

  /* ── Obsługa pliku ────────────────────────────────────────────────── */
  function handleFiles(files) {
    var pdf = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].type === 'application/pdf' || files[i].name.toLowerCase().endsWith('.pdf')) {
        pdf = files[i]; break;
      }
    }
    if (!pdf) {
      showError('To nie jest plik PDF. Obsługiwane są wyłącznie pliki .pdf.');
      return;
    }
    clearAll();
    loadFile(pdf);
  }

  function loadFile(file) {
    originalFileName = file.name;
    showProgress(true);
    setProgress(0, 'Wczytuję: ' + file.name);

    var reader = new FileReader();
    reader.onload = function (e) {
      var arrayBuffer = e.target.result;
      originalBytes = new Uint8Array(arrayBuffer.slice(0));
      var data = new Uint8Array(arrayBuffer);

      pdfjsLib.getDocument({ data: data }).promise.then(function (pdfDoc) {
        var numPages = pdfDoc.numPages;
        var newEntries = [];

        for (var p = 1; p <= numPages; p++) {
          newEntries.push({
            id:        'p' + (++idCounter),
            pageIndex: p - 1,
            pdfDoc:    pdfDoc,
            rotation:  0,
            el:        null
          });
        }

        newEntries.forEach(function (entry) {
          pages.push(entry);
          var card = createCard(entry);
          entry.el = card;
          pageGrid.appendChild(card);
        });

        setProgress(0.5, 'Renderuję miniatury…');
        renderThumbnailsLazy(newEntries, 0, function () {
          showProgress(false);
          updateWorkspace();
        });
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

  function renderThumbnailsLazy(entries, startIdx, onAllDone) {
    var BATCH = 4;
    var end = Math.min(startIdx + BATCH, entries.length);
    var promises = [];
    for (var i = startIdx; i < end; i++) {
      promises.push(renderThumbnail(entries[i]));
    }
    function batchDone() {
      if (end < entries.length) {
        setTimeout(function () { renderThumbnailsLazy(entries, end, onAllDone); }, 0);
      } else {
        if (onAllDone) onAllDone();
      }
    }
    Promise.all(promises).then(batchDone).catch(batchDone);
  }

  function renderThumbnail(entry) {
    if (!entry.el) return Promise.resolve();
    var canvas  = entry.el.querySelector('.pc-canvas');
    var spinner = entry.el.querySelector('.pc-spinner');

    return entry.pdfDoc.getPage(entry.pageIndex + 1).then(function (page) {
      var viewport = page.getViewport({ scale: 1, rotation: entry.rotation });
      var scale    = 148 / viewport.width;
      var vp       = page.getViewport({ scale: scale, rotation: entry.rotation });
      canvas.width  = vp.width;
      canvas.height = vp.height;
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }).then(function () {
      if (spinner) spinner.classList.add('hidden');
    }).catch(function () {
      if (spinner) spinner.classList.add('hidden');
    });
  }

  /* ── Karta strony ─────────────────────────────────────────────────── */
  function createCard(entry) {
    var frag = pageTpl.content.cloneNode(true);
    var card = frag.querySelector('.page-card');
    card.dataset.id = entry.id;
    card.setAttribute('tabindex', '0');

    var posIn  = card.querySelector('.pc-pos-input');
    var btnRot = card.querySelector('.pc-rotate');
    var btnDel = card.querySelector('.pc-delete');
    var btnL   = card.querySelector('.pc-move-left');
    var btnR   = card.querySelector('.pc-move-right');

    updateCardMeta(card, entry);
    posIn.value = pages.length + 1;

    btnRot.addEventListener('click', function (e) {
      e.stopPropagation();
      entry.rotation = (entry.rotation + 90) % 360;
      renderThumbnail(entry);
    });
    btnDel.addEventListener('click', function (e) {
      e.stopPropagation(); removePage(entry.id);
    });
    btnL.addEventListener('click', function (e) {
      e.stopPropagation(); movePageBy(entry.id, -1);
    });
    btnR.addEventListener('click', function (e) {
      e.stopPropagation(); movePageBy(entry.id, +1);
    });
    posIn.addEventListener('change', function () {
      movePageTo(entry.id, parseInt(posIn.value, 10) - 1);
    });
    posIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') posIn.blur();
    });

    card.addEventListener('dragstart', onCardDragStart);
    card.addEventListener('dragover',  onCardDragOver);
    card.addEventListener('dragleave', onCardDragLeave);
    card.addEventListener('drop',      onCardDrop);
    card.addEventListener('dragend',   onCardDragEnd);

    return card;
  }

  function updateCardMeta(card, entry) {
    var idx   = pages.indexOf(entry);
    var numEl = card.querySelector('.pc-num');
    var posIn = card.querySelector('.pc-pos-input');
    var btnL  = card.querySelector('.pc-move-left');
    var btnR  = card.querySelector('.pc-move-right');
    numEl.textContent = 'Str. ' + (idx + 1);
    posIn.value = idx + 1;
    posIn.max   = pages.length;
    btnL.disabled = (idx === 0);
    btnR.disabled = (idx === pages.length - 1);
  }

  /* ── Drag-and-drop miniatur ───────────────────────────────────────── */
  var dragSrcId = null;

  function onCardDragStart(e) {
    dragSrcId = this.dataset.id;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }
  function onCardDragOver(e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (this.dataset.id !== dragSrcId) this.classList.add('drag-over');
  }
  function onCardDragLeave() { this.classList.remove('drag-over'); }
  function onCardDrop(e) {
    e.preventDefault(); this.classList.remove('drag-over');
    if (dragSrcId && this.dataset.id && dragSrcId !== this.dataset.id) {
      swapPages(dragSrcId, this.dataset.id);
    }
  }
  function onCardDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.page-card.drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
    dragSrcId = null;
  }

  /* ── Operacje na stronach ─────────────────────────────────────────── */
  function removePage(id) {
    var idx = indexById(id);
    if (idx === -1) return;
    var entry = pages[idx];
    if (entry.el) entry.el.remove();
    pages.splice(idx, 1);
    updateWorkspace();
  }

  function movePageBy(id, delta) {
    var idx    = indexById(id);
    var newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= pages.length) return;
    swapByIndex(idx, newIdx);
  }

  function movePageTo(id, targetIdx) {
    var idx = indexById(id);
    if (idx === -1) return;
    targetIdx = Math.max(0, Math.min(pages.length - 1, targetIdx));
    if (idx === targetIdx) { updateWorkspace(); return; }
    var entry = pages.splice(idx, 1)[0];
    pages.splice(targetIdx, 0, entry);
    rebuildGrid();
    updateWorkspace();
  }

  function swapPages(idA, idB) {
    swapByIndex(indexById(idA), indexById(idB));
  }

  function swapByIndex(iA, iB) {
    var tmp = pages[iA]; pages[iA] = pages[iB]; pages[iB] = tmp;
    rebuildGrid(); updateWorkspace();
  }

  function rebuildGrid() {
    pages.forEach(function (entry) { if (entry.el) pageGrid.appendChild(entry.el); });
  }

  function indexById(id) {
    for (var i = 0; i < pages.length; i++) { if (pages[i].id === id) return i; }
    return -1;
  }

  function clearAll() {
    pages = []; idCounter = 0; originalBytes = null; originalFileName = null;
    pageGrid.innerHTML = '';
    if (errorBox) { errorBox.hidden = true; }
    updateWorkspace();
  }

  /* ── UI ───────────────────────────────────────────────────────────── */
  function updateWorkspace() {
    if (pages.length === 0) { workspace.hidden = true; return; }
    workspace.hidden = false;
    wsCount.textContent = pages.length + ' ' + pluralStr(pages.length, 'strona', 'strony', 'stron');
    pages.forEach(function (entry) { if (entry.el) updateCardMeta(entry.el, entry); });
  }

  function showProgress(visible) {
    loadProgress.style.display = visible ? 'flex' : 'none';
  }
  function setProgress(ratio, label) {
    lpFill.style.width = Math.round(ratio * 100) + '%';
    lpLabel.textContent = label;
  }

  function ensureErrorBox() {
    if (!errorBox) {
      errorBox = document.createElement('div');
      errorBox.className = 'file-error';
      errorBox.setAttribute('role', 'alert');
      dropzone.parentNode.insertBefore(errorBox, dropzone.nextSibling);
    }
    return errorBox;
  }

  function showError(message) {
    var box = ensureErrorBox();
    box.hidden = false;
    box.innerHTML =
      '<span class="ti ti-alert-circle" aria-hidden="true"></span>' +
      '<div class="file-error-body"><div class="file-error-msg">' + escHtml(message) + '</div></div>' +
      '<button class="file-error-close" aria-label="Zamknij">' +
        '<span class="ti ti-x" aria-hidden="true"></span></button>';
    box.querySelector('.file-error-close').addEventListener('click', function () {
      box.hidden = true;
    });
  }

  function classifyPdfError(err) {
    var msg = (err && err.message) ? err.message.toLowerCase() : '';
    if (msg.indexOf('password') !== -1 || msg.indexOf('encrypted') !== -1)
      return 'Plik jest zabezpieczony hasłem. Usuń ochronę przed organizowaniem.';
    if (msg.indexOf('invalid pdf') !== -1 || msg.indexOf('missing pdf') !== -1)
      return 'Plik jest uszkodzony lub nie jest prawidłowym dokumentem PDF.';
    return 'Nie udało się otworzyć pliku PDF. Sprawdź, czy plik nie jest uszkodzony.';
  }

  /* ── Zapis PDF ────────────────────────────────────────────────────── */
  function savePDF() {
    if (pages.length === 0 || !originalBytes) return;
    var PDFLib = window.PDFLib;
    if (!PDFLib) {
      organizeInfo.textContent = 'Błąd: biblioteka pdf-lib nie jest dostępna.';
      return;
    }

    btnSave.disabled = true;
    organizeInfo.textContent = 'Przygotowuję plik…';

    PDFLib.PDFDocument.load(originalBytes).then(function (srcDoc) {
      return PDFLib.PDFDocument.create().then(function (outDoc) {
        return pages.reduce(function (chain, entry) {
          return chain.then(function () {
            return outDoc.copyPages(srcDoc, [entry.pageIndex]).then(function (copied) {
              var page = copied[0];
              if (entry.rotation !== 0) {
                var cur = page.getRotation().angle;
                page.setRotation(PDFLib.degrees((cur + entry.rotation) % 360));
              }
              outDoc.addPage(page);
            });
          });
        }, Promise.resolve()).then(function () { return outDoc; });
      });
    }).then(function (outDoc) {
      return outDoc.save();
    }).then(function (bytes) {
      var dot = originalFileName ? originalFileName.lastIndexOf('.') : -1;
      var base = (dot !== -1 && originalFileName) ? originalFileName.substring(0, dot) : (originalFileName || 'dokument');
      downloadBytes(bytes, base + '-zorganizowany.pdf');
      organizeInfo.textContent = 'Pobrano · ' + pages.length + ' ' +
        pluralStr(pages.length, 'strona', 'strony', 'stron');
      btnSave.disabled = false;
    }).catch(function (err) {
      organizeInfo.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany błąd');
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
