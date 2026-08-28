/**
 * merge.js — Scalanie plików PDF
 * Wszystko działa lokalnie: pdf.js (miniatury) + pdf-lib (składanie wyniku).
 * Żadne dane użytkownika nie opuszczają przeglądarki.
 */
(function () {
  'use strict';

  /* ── Konfiguracja pdf.js ─────────────────────────────────────────────── */
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ── Stan aplikacji ──────────────────────────────────────────────────── */
  /**
   * @typedef {{ id: string, fileName: string, pageIndex: number,
   *             pdfDoc: object, rotation: number, el: HTMLElement|null }} PageEntry
   */
  /** @type {PageEntry[]} */
  var pages = [];
  var idCounter = 0;

  /* ── Elementy DOM ────────────────────────────────────────────────────── */
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var loadProgress = document.getElementById('loadProgress');
  var lpFill       = document.getElementById('lpFill');
  var lpLabel      = document.getElementById('lpLabel');
  var workspace    = document.getElementById('workspace');
  var wsCount      = document.getElementById('wsCount');
  var pageGrid     = document.getElementById('pageGrid');
  var btnAddMore   = document.getElementById('btnAddMore');
  var btnClear     = document.getElementById('btnClear');
  var btnMerge     = document.getElementById('btnMerge');
  var mergeInfo    = document.getElementById('mergeInfo');
  var pageTpl      = document.getElementById('pageTpl');

  /* kontener na błędy — tworzymy dynamicznie */
  var errorsList = null;

  /* ── Drag-and-drop plików ────────────────────────────────────────────── */
  dropzone.addEventListener('click', function () { picker.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
  });

  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropzone.classList.add('over');
  });
  dropzone.addEventListener('dragleave', function () {
    dropzone.classList.remove('over');
  });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('over');
    handleFiles(Array.from(e.dataTransfer.files));
  });

  picker.addEventListener('change', function () {
    handleFiles(Array.from(picker.files));
    picker.value = '';
  });

  btnAddMore.addEventListener('click', function () { picker.click(); });
  btnClear.addEventListener('click', clearAll);
  btnMerge.addEventListener('click', mergePDF);

  /* ── Obsługa plików ──────────────────────────────────────────────────── */
  /**
   * @param {File[]} files
   */
  function handleFiles(files) {
    var pdfs = files.filter(function (f) {
      return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
    });
    var nonPdfs = files.filter(function (f) {
      return f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf');
    });

    nonPdfs.forEach(function (f) {
      showError(f.name, 'To nie jest plik PDF. Obsługiwane są wyłącznie pliki .pdf.');
    });

    if (pdfs.length === 0) return;
    loadFiles(pdfs);
  }

  /**
   * Wczytuje pliki PDF sekwencyjnie, pokazując postęp.
   * @param {File[]} files
   */
  function loadFiles(files) {
    showProgress(true);
    var total = files.length;
    var done  = 0;

    function next(i) {
      if (i >= files.length) {
        showProgress(false);
        updateWorkspace();
        return;
      }
      setProgress(i / total, 'Wczytuję: ' + files[i].name);
      loadSingleFile(files[i], function () {
        done++;
        setProgress(done / total, done < total
          ? 'Wczytuję: ' + files[i + 1].name
          : 'Gotowe');
        next(i + 1);
      });
    }
    next(0);
  }

  /**
   * @param {File} file
   * @param {function} onDone
   */
  function loadSingleFile(file, onDone) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var data = new Uint8Array(e.target.result);
      pdfjsLib.getDocument({ data: data }).promise.then(function (pdfDoc) {
        var numPages = pdfDoc.numPages;
        var newEntries = [];
        for (var p = 1; p <= numPages; p++) {
          newEntries.push({
            id:        'p' + (++idCounter),
            fileName:  file.name,
            pageIndex: p - 1,   /* 0-based dla pdf.js */
            pdfDoc:    pdfDoc,
            rotation:  0,
            el:        null
          });
        }
        /* Dodaj karty do DOM od razu, renderuj miniatury leniwie */
        newEntries.forEach(function (entry) {
          pages.push(entry);
          var card = createCard(entry);
          entry.el = card;
          pageGrid.appendChild(card);
        });
        /* Renderuj miniatury przyrostowo — nie blokuj UI */
        renderThumbnailsLazy(newEntries, 0, onDone);
      }, function (err) {
        var msg = classifyPdfError(err);
        showError(file.name, msg);
        onDone();
      });
    };
    reader.onerror = function () {
      showError(file.name, 'Nie udało się odczytać pliku. Sprawdź, czy plik nie jest uszkodzony.');
      onDone();
    };
    reader.readAsArrayBuffer(file);
  }

  /**
   * Renderuje miniatury partiami, żeby nie zamrozić UI przy dużej liczbie stron.
   * @param {PageEntry[]} entries
   * @param {number} startIdx
   * @param {function} onAllDone
   */
  function renderThumbnailsLazy(entries, startIdx, onAllDone) {
    var BATCH = 4;
    var end   = Math.min(startIdx + BATCH, entries.length);

    var promises = [];
    for (var i = startIdx; i < end; i++) {
      promises.push(renderThumbnail(entries[i]));
    }

    Promise.all(promises).then(function () {
      if (end < entries.length) {
        /* Oddaj sterowanie przeglądarce przed kolejną partią */
        setTimeout(function () {
          renderThumbnailsLazy(entries, end, onAllDone);
        }, 0);
      } else {
        if (onAllDone) onAllDone();
      }
    });
  }

  /**
   * @param {PageEntry} entry
   * @returns {Promise<void>}
   */
  function renderThumbnail(entry) {
    if (!entry.el) return Promise.resolve();
    var canvas  = entry.el.querySelector('.pc-canvas');
    var spinner = entry.el.querySelector('.pc-spinner');

    return entry.pdfDoc.getPage(entry.pageIndex + 1).then(function (page) {
      var viewport = page.getViewport({ scale: 1, rotation: entry.rotation });
      /* Dopasuj do szerokości karty (~148px) */
      var scale    = 148 / viewport.width;
      var vp       = page.getViewport({ scale: scale, rotation: entry.rotation });

      canvas.width  = vp.width;
      canvas.height = vp.height;

      return page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: vp
      }).promise;
    }).then(function () {
      if (spinner) spinner.classList.add('hidden');
    }).catch(function () {
      if (spinner) spinner.classList.add('hidden');
    });
  }

  /* ── Tworzenie karty strony ──────────────────────────────────────────── */
  /**
   * @param {PageEntry} entry
   * @returns {HTMLElement}
   */
  function createCard(entry) {
    var frag = pageTpl.content.cloneNode(true);
    var card = frag.querySelector('.page-card');

    card.dataset.id = entry.id;
    card.setAttribute('tabindex', '0');

    var numEl  = card.querySelector('.pc-num');
    var srcEl  = card.querySelector('.pc-src');
    var posIn  = card.querySelector('.pc-pos-input');
    var btnRot = card.querySelector('.pc-rotate');
    var btnDel = card.querySelector('.pc-delete');
    var btnL   = card.querySelector('.pc-move-left');
    var btnR   = card.querySelector('.pc-move-right');

    updateCardMeta(card, entry);
    posIn.value = pages.length + 1; /* tymczasowo; updateWorkspace naprawi */

    /* Obrót */
    btnRot.addEventListener('click', function (e) {
      e.stopPropagation();
      entry.rotation = (entry.rotation + 90) % 360;
      renderThumbnail(entry);
    });

    /* Usunięcie */
    btnDel.addEventListener('click', function (e) {
      e.stopPropagation();
      removePage(entry.id);
    });

    /* Klawiaturowe przesunięcie */
    btnL.addEventListener('click', function (e) {
      e.stopPropagation();
      movePageBy(entry.id, -1);
    });
    btnR.addEventListener('click', function (e) {
      e.stopPropagation();
      movePageBy(entry.id, +1);
    });

    /* Pole z numerem pozycji */
    posIn.addEventListener('change', function () {
      var target = parseInt(posIn.value, 10) - 1;
      movePageTo(entry.id, target);
    });
    posIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') posIn.blur();
    });

    /* Drag-and-drop miniatur */
    card.addEventListener('dragstart', onCardDragStart);
    card.addEventListener('dragover',  onCardDragOver);
    card.addEventListener('dragleave', onCardDragLeave);
    card.addEventListener('drop',      onCardDrop);
    card.addEventListener('dragend',   onCardDragEnd);

    return card;
  }

  function updateCardMeta(card, entry) {
    var idx    = pages.indexOf(entry);
    var numEl  = card.querySelector('.pc-num');
    var srcEl  = card.querySelector('.pc-src');
    var posIn  = card.querySelector('.pc-pos-input');
    var btnL   = card.querySelector('.pc-move-left');
    var btnR   = card.querySelector('.pc-move-right');

    numEl.textContent = 'Str. ' + (idx + 1);
    srcEl.textContent = entry.fileName;
    posIn.value       = idx + 1;
    posIn.max         = pages.length;

    btnL.disabled = (idx === 0);
    btnR.disabled = (idx === pages.length - 1);
  }

  /* ── Drag-and-drop miniatur ──────────────────────────────────────────── */
  var dragSrcId = null;

  function onCardDragStart(e) {
    dragSrcId = this.dataset.id;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }
  function onCardDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this.dataset.id !== dragSrcId) this.classList.add('drag-over');
  }
  function onCardDragLeave() {
    this.classList.remove('drag-over');
  }
  function onCardDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    var targetId = this.dataset.id;
    if (dragSrcId && targetId && dragSrcId !== targetId) {
      swapPages(dragSrcId, targetId);
    }
  }
  function onCardDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.page-card.drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
    dragSrcId = null;
  }

  /* ── Operacje na liście stron ────────────────────────────────────────── */
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
    /* Przebuduj DOM w nowej kolejności */
    rebuildGrid();
    updateWorkspace();
  }

  function swapPages(idA, idB) {
    var iA = indexById(idA);
    var iB = indexById(idB);
    if (iA === -1 || iB === -1) return;
    swapByIndex(iA, iB);
  }

  function swapByIndex(iA, iB) {
    var tmp   = pages[iA];
    pages[iA] = pages[iB];
    pages[iB] = tmp;
    rebuildGrid();
    updateWorkspace();
  }

  function rebuildGrid() {
    pages.forEach(function (entry) {
      if (entry.el) pageGrid.appendChild(entry.el);
    });
  }

  function indexById(id) {
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].id === id) return i;
    }
    return -1;
  }

  function clearAll() {
    pages = [];
    pageGrid.innerHTML = '';
    if (errorsList) { errorsList.innerHTML = ''; }
    updateWorkspace();
  }

  /* ── Aktualizacja UI ─────────────────────────────────────────────────── */
  function updateWorkspace() {
    if (pages.length === 0) {
      workspace.hidden = true;
      return;
    }
    workspace.hidden = false;

    var fileSet = {};
    pages.forEach(function (p) { fileSet[p.fileName] = true; });
    var fileCount = Object.keys(fileSet).length;

    wsCount.textContent =
      pages.length + ' ' + pluralStr(pages.length, 'strona', 'strony', 'stron') +
      ' z ' + fileCount + ' ' + pluralStr(fileCount, 'pliku', 'plików', 'plików');

    /* Odśwież metadane każdej karty */
    pages.forEach(function (entry) {
      if (entry.el) updateCardMeta(entry.el, entry);
    });
  }

  function showProgress(visible) {
    loadProgress.hidden = !visible;
  }

  function setProgress(ratio, label) {
    lpFill.style.width = Math.round(ratio * 100) + '%';
    lpLabel.textContent = label;
  }

  /* ── Komunikaty błędów ───────────────────────────────────────────────── */
  function ensureErrorsList() {
    if (!errorsList) {
      errorsList = document.createElement('div');
      errorsList.className = 'errors-list';
      /* Wstaw po dropzone */
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
      '<button class="file-error-close" aria-label="Zamknij komunikat">' +
        '<span class="ti ti-x" aria-hidden="true"></span>' +
      '</button>';

    item.querySelector('.file-error-close').addEventListener('click', function () {
      item.remove();
    });

    list.appendChild(item);
  }

  /**
   * Klasyfikuje błąd pdf.js na czytelny komunikat.
   * @param {Error} err
   * @returns {string}
   */
  function classifyPdfError(err) {
    var msg = (err && err.message) ? err.message.toLowerCase() : '';
    if (msg.indexOf('password') !== -1 || msg.indexOf('encrypted') !== -1) {
      return 'Plik jest zabezpieczony hasłem. Usuń ochronę przed scaleniem.';
    }
    if (msg.indexOf('invalid pdf') !== -1 || msg.indexOf('missing pdf') !== -1 ||
        msg.indexOf('unexpected') !== -1) {
      return 'Plik jest uszkodzony lub nie jest prawidłowym dokumentem PDF.';
    }
    return 'Nie udało się otworzyć pliku PDF. Sprawdź, czy plik nie jest uszkodzony lub zaszyfrowany.';
  }

  /* ── Scalanie i pobieranie ───────────────────────────────────────────── */
  function mergePDF() {
    if (pages.length === 0) return;

    btnMerge.disabled = true;
    mergeInfo.textContent = 'Składam plik…';

    /* pdf-lib jest dostępne jako globalny PDFLib */
    var PDFLib = window.PDFLib;
    if (!PDFLib) {
      mergeInfo.textContent = 'Błąd: biblioteka pdf-lib nie jest dostępna.';
      btnMerge.disabled = false;
      return;
    }

    var mergedDoc;
    PDFLib.PDFDocument.create().then(function (doc) {
      mergedDoc = doc;
      return pages.reduce(function (chain, entry) {
        return chain.then(function () {
          return copyPage(mergedDoc, entry);
        });
      }, Promise.resolve());
    }).then(function () {
      return mergedDoc.save();
    }).then(function (bytes) {
      downloadBytes(bytes, 'scalony-dokument.pdf');
      mergeInfo.textContent =
        'Pobrano · ' + pages.length + ' ' +
        pluralStr(pages.length, 'strona', 'strony', 'stron');
      btnMerge.disabled = false;
    }).catch(function (err) {
      mergeInfo.textContent = 'Błąd podczas scalania: ' + (err && err.message ? err.message : 'nieznany błąd');
      btnMerge.disabled = false;
    });
  }

  /**
   * Kopiuje jedną stronę (z obrotem) do dokumentu docelowego.
   * @param {object} mergedDoc  — PDFDocument (pdf-lib)
   * @param {PageEntry} entry
   * @returns {Promise<void>}
   */
  function copyPage(mergedDoc, entry) {
    var PDFLib = window.PDFLib;

    /* Pobierz bajty strony źródłowej przez pdf.js */
    return entry.pdfDoc.getData().then(function (data) {
      return PDFLib.PDFDocument.load(data, { ignoreEncryption: false });
    }).then(function (srcDoc) {
      return mergedDoc.copyPages(srcDoc, [entry.pageIndex]);
    }).then(function (copiedPages) {
      var page = copiedPages[0];

      /* Zastosuj obrót */
      if (entry.rotation !== 0) {
        var current = page.getRotation().angle;
        page.setRotation(PDFLib.degrees((current + entry.rotation) % 360));
      }

      mergedDoc.addPage(page);
    });
  }

  /* ── Pobieranie pliku ────────────────────────────────────────────────── */
  /**
   * @param {Uint8Array} bytes
   * @param {string} filename
   */
  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /* ── Pomocnicze ──────────────────────────────────────────────────────── */
  /**
   * Polska odmiana liczebnikowa.
   * @param {number} n
   * @param {string} one   — 1
   * @param {string} few   — 2–4
   * @param {string} many  — 5+
   */
  function pluralStr(n, one, few, many) {
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
