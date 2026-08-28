/**
 * sign.js — Wypełnianie i podpisywanie PDF
 *
 * Architektura:
 *  - PDF.js  → renderowanie podglądu stron (canvas)
 *  - pdf-lib → zapis adnotacji trwale do pliku wynikowego
 *  - Warstwa .annot-layer leży pixel-perfect na canvasie każdej strony.
 *    Przeliczanie współrzędnych: piksel CSS → punkt PDF uwzględnia
 *    skalę renderowania i wymiary strony PDF.
 *
 * Polskie znaki: pdf-lib domyślnie nie obsługuje UTF-8 w standardowych
 * czcionkach. Używamy embedFont z PDFLib.StandardFonts.Helvetica dla
 * znaków ASCII, a dla polskich znaków osadzamy czcionkę NotoSans
 * pobieraną z Google Fonts jako ArrayBuffer.
 *
 * Wszystko działa lokalnie — żadne dane nie opuszczają przeglądarki.
 */
(function () {
  'use strict';

  /* ── Konfiguracja PDF.js ─────────────────────────────────────────────── */
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ── Stałe ───────────────────────────────────────────────────────────── */
  var RENDER_SCALE   = 1.5;
  var MAX_PAGE_WIDTH = 860;
  var LS_KEY_SIG     = 'aizyl_sign_signature';
  var LS_KEY_INIT    = 'aizyl_sign_initial';
  var LS_KEY_STAMP   = 'aizyl_sign_stamp';

  /* ── Stan aplikacji ──────────────────────────────────────────────────── */
  var state = {
    pdfDoc:      null,
    pdfBytes:    null,
    fileName:    '',
    pages:       [],
    annots:      [],
    history:     [],
    activeTool:  'text',
    fontSize:    12,
    fontColor:   '#000000',
    checkSymbol: '\u2713',
    selectedId:  null,
    dragState:   null,
    resizeState: null,
    pendingInsert: null,   /* { pageEntry, xCss, yCss, tool } */
    sigDrawing:  false,
    sigLastX:    0,
    sigLastY:    0,
    sigHasData:  false,
    sigPreviewDataUrl: null,
    activeModalTool: 'sign',
  };

  var annotIdCounter = 0;

  /* ── Elementy DOM ────────────────────────────────────────────────────── */
  var dropzone      = document.getElementById('dropzone');
  var picker        = document.getElementById('picker');
  var loadProgress  = document.getElementById('loadProgress');
  var lpFill        = document.getElementById('lpFill');
  var lpLabel       = document.getElementById('lpLabel');
  var errorsList    = document.getElementById('errorsList');
  var workspace     = document.getElementById('workspace');
  var pagesInner    = document.getElementById('pagesInner');
  var statusText    = document.getElementById('statusText');
  var btnDownload   = document.getElementById('btnDownload');
  var btnClose      = document.getElementById('btnClose');
  var btnUndo       = document.getElementById('btnUndo');

  var toolBtns      = document.querySelectorAll('.tool-btn[data-tool]');
  var textOpts      = document.getElementById('textOpts');
  var checkOpts     = document.getElementById('checkOpts');
  var fontSizeEl    = document.getElementById('fontSize');
  var fontColorEl   = document.getElementById('fontColor');
  var checkSymBtns  = document.querySelectorAll('.check-sym');

  var signModal        = document.getElementById('signModal');
  var signModalTitle   = document.getElementById('signModalTitle');
  var signModalClose   = document.getElementById('signModalClose');
  var tabDraw          = document.getElementById('tabDraw');
  var tabUpload        = document.getElementById('tabUpload');
  var paneDraw         = document.getElementById('paneDraw');
  var paneUpload       = document.getElementById('paneUpload');
  var sigCanvas        = document.getElementById('sigCanvas');
  var sigHint          = document.getElementById('sigHint');
  var btnSigClear      = document.getElementById('btnSigClear');
  var sigUploadDrop    = document.getElementById('sigUploadDrop');
  var sigImagePicker   = document.getElementById('sigImagePicker');
  var sigPreviewCanvas = document.getElementById('sigPreviewCanvas');
  var chkSaveSig       = document.getElementById('chkSaveSig');
  var btnSigCancel     = document.getElementById('btnSigCancel');
  var btnSigConfirm    = document.getElementById('btnSigConfirm');
  var savedSigRow      = document.getElementById('savedSigRow');
  var btnUseSaved      = document.getElementById('btnUseSaved');
  var btnDeleteSaved   = document.getElementById('btnDeleteSaved');

  /* ── Dropzone pliku ──────────────────────────────────────────────────── */
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
    var files = Array.from(e.dataTransfer.files);
    if (files.length) handleFile(files[0]);
  });
  picker.addEventListener('change', function () {
    if (picker.files.length) handleFile(picker.files[0]);
    picker.value = '';
  });

  btnClose.addEventListener('click', resetAll);
  btnDownload.addEventListener('click', downloadPdf);
  btnUndo.addEventListener('click', undo);

  /* Ctrl+Z */
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
  });

  /* ── Narzędzia ───────────────────────────────────────────────────────── */
  toolBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setActiveTool(btn.dataset.tool);
    });
  });

  fontSizeEl.addEventListener('change', function () {
    state.fontSize = parseInt(fontSizeEl.value, 10);
  });
  fontColorEl.addEventListener('input', function () {
    state.fontColor = fontColorEl.value;
  });

  checkSymBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      checkSymBtns.forEach(function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state.checkSymbol = btn.dataset.sym;
    });
  });

  function setActiveTool(tool) {
    state.activeTool = tool;
    toolBtns.forEach(function (btn) {
      var active = btn.dataset.tool === tool;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    /* Pokaż/ukryj opcje */
    textOpts.hidden  = (tool !== 'text' && tool !== 'date');
    checkOpts.hidden = (tool !== 'check');
    /* Kursor na warstwach */
    state.pages.forEach(function (p) {
      p.annotLayer.className = 'annot-layer tool-' + tool;
    });
    setStatus('Aktywne narzędzie: ' + toolLabel(tool) + '. Kliknij w dokument, żeby dodać element.');
  }

  function toolLabel(tool) {
    var labels = {
      text: 'Tekst', check: 'Ptaszek/krzyżyk', date: 'Data',
      sign: 'Podpis', initial: 'Parafka', stamp: 'Pieczątka'
    };
    return labels[tool] || tool;
  }

  /* ── Obsługa pliku ───────────────────────────────────────────────────── */
  function handleFile(file) {
    clearErrors();
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showError(file.name, 'To nie jest plik PDF. Obsługiwane są wyłącznie pliki .pdf.');
      return;
    }
    state.fileName = file.name;
    var reader = new FileReader();
    reader.onload = function (e) {
      /* Zachowaj oryginalne bajty — pdf.js może odłączyć przekazany bufor
         przy transferze do workera. Trzymamy osobną kopię dla pdf-lib. */
      var originalBuffer = e.target.result;
      state.pdfBytes = new Uint8Array(originalBuffer.slice(0));
      /* pdf.js dostaje własną kopię — nie dotyka state.pdfBytes */
      openPdf(new Uint8Array(originalBuffer.slice(0)));
    };
    reader.onerror = function () {
      showError(file.name, 'Nie udało się odczytać pliku. Sprawdź, czy plik nie jest uszkodzony.');
    };
    reader.readAsArrayBuffer(file);
  }

  function openPdf(bytes) {
    showProgress(true, 0, 'Wczytuję dokument…');
    /* Przekazujemy kopię — pdf.js może transferować bufor do workera */
    pdfjsLib.getDocument({ data: bytes }).promise.then(function (pdfDoc) {
      state.pdfDoc  = pdfDoc;
      state.pages   = [];
      state.annots  = [];
      state.history = [];
      pagesInner.innerHTML = '';
      workspace.hidden = false;
      renderAllPages(pdfDoc);
    }, function (err) {
      showProgress(false);
      showError(state.fileName, classifyPdfError(err));
    });
  }

  function renderAllPages(pdfDoc) {
    var total = pdfDoc.numPages;
    var done  = 0;

    function renderNext(pageNum) {
      if (pageNum > total) {
        showProgress(false);
        detectFormFields();
        setStatus('Kliknij w dokument, żeby dodać element. Aktywne narzędzie: ' + toolLabel(state.activeTool));
        return;
      }
      showProgress(true, (pageNum - 1) / total, 'Renderuję stronę ' + pageNum + ' z ' + total + '\u2026');
      pdfDoc.getPage(pageNum).then(function (pdfPage) {
        var pageEntry = buildPageContainer(pdfPage, pageNum);
        state.pages.push(pageEntry);
        pagesInner.appendChild(pageEntry.container);
        done++;
        renderNext(pageNum + 1);
      });
    }
    renderNext(1);
  }

  /* ── Budowanie kontenera strony ──────────────────────────────────────── */
  function buildPageContainer(pdfPage, pageNum) {
    var baseViewport = pdfPage.getViewport({ scale: 1 });

    /* Oblicz skalę CSS tak, żeby strona nie przekraczała MAX_PAGE_WIDTH */
    var cssScale = Math.min(RENDER_SCALE, MAX_PAGE_WIDTH / baseViewport.width);
    var cssW = Math.round(baseViewport.width  * cssScale);
    var cssH = Math.round(baseViewport.height * cssScale);

    /* Viewport do renderowania (DPR dla ostrości) */
    var dpr = window.devicePixelRatio || 1;
    var renderViewport = pdfPage.getViewport({ scale: cssScale * dpr });

    /* Kontener */
    var container = document.createElement('div');
    container.className = 'page-container';
    container.style.width  = cssW + 'px';
    container.style.height = cssH + 'px';
    container.dataset.pageNum = pageNum;

    /* Canvas */
    var canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.width  = renderViewport.width;
    canvas.height = renderViewport.height;
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    container.appendChild(canvas);

    pdfPage.render({
      canvasContext: canvas.getContext('2d'),
      viewport: renderViewport
    });

    /* Warstwa adnotacji */
    var annotLayer = document.createElement('div');
    annotLayer.className = 'annot-layer tool-' + state.activeTool;
    container.appendChild(annotLayer);

    var pageEntry = {
      pageNum:    pageNum,
      pdfPage:    pdfPage,
      container:  container,
      canvas:     canvas,
      annotLayer: annotLayer,
      cssW:       cssW,
      cssH:       cssH,
      pdfW:       baseViewport.width,
      pdfH:       baseViewport.height,
    };

    /* Kliknięcie w warstwę */
    annotLayer.addEventListener('click', function (e) {
      if (e.target !== annotLayer) return;
      var rect = annotLayer.getBoundingClientRect();
      onLayerClick(e.clientX - rect.left, e.clientY - rect.top, pageEntry);
    });

    annotLayer.addEventListener('mousedown', function (e) {
      if (e.target === annotLayer) deselectAll();
    });

    return pageEntry;
  }

  /* ── Przeliczanie współrzędnych ──────────────────────────────────────── */
  function cssToPdf(pageEntry, xCss, yCss) {
    var scaleX = pageEntry.pdfW / pageEntry.cssW;
    var scaleY = pageEntry.pdfH / pageEntry.cssH;
    return {
      x: xCss * scaleX,
      y: pageEntry.pdfH - yCss * scaleY,
    };
  }

  function cssSizeToPdf(pageEntry, wCss, hCss) {
    return {
      w: wCss * (pageEntry.pdfW / pageEntry.cssW),
      h: hCss * (pageEntry.pdfH / pageEntry.cssH),
    };
  }

  /* ── Kliknięcie w warstwę ────────────────────────────────────────────── */
  function onLayerClick(xCss, yCss, pageEntry) {
    var tool = state.activeTool;
    if (tool === 'text') {
      pushHistory();
      addTextAnnot(pageEntry, xCss, yCss, '', true);
    } else if (tool === 'check') {
      pushHistory();
      addCheckAnnot(pageEntry, xCss, yCss, state.checkSymbol);
    } else if (tool === 'date') {
      pushHistory();
      addTextAnnot(pageEntry, xCss, yCss, formatDate(new Date()), false);
    } else if (tool === 'sign' || tool === 'initial' || tool === 'stamp') {
      state.pendingInsert = { pageEntry: pageEntry, xCss: xCss, yCss: yCss, tool: tool };
      openSignModal(tool);
    }
  }

  /* ── Adnotacja: tekst ────────────────────────────────────────────────── */
  function addTextAnnot(pageEntry, xCss, yCss, initialText, startEditing) {
    var id       = 'a' + (++annotIdCounter);
    var fontSize = state.fontSize;
    var color    = state.fontColor;
    var estW     = Math.max(80, (initialText.length || 10) * fontSize * 0.62);
    var estH     = fontSize * 1.7;

    var el = makeAnnotEl(id, xCss, yCss, estW, estH);
    el.classList.add('annot-type-text');

    var textEl = document.createElement('div');
    textEl.className = 'annot-text-el';
    textEl.style.fontSize = fontSize + 'px';
    textEl.style.color    = color;
    textEl.textContent    = initialText;

    el.appendChild(makeAnnotMove());
    el.appendChild(textEl);
    el.appendChild(makeAnnotResize());
    el.appendChild(makeAnnotDelete());
    pageEntry.annotLayer.appendChild(el);

    var entry = {
      id: id, type: 'text', pageNum: pageEntry.pageNum,
      xCss: xCss, yCss: yCss, wCss: estW, hCss: estH,
      text: initialText, fontSize: fontSize, color: color, el: el,
    };
    state.annots.push(entry);
    bindAnnotEvents(el, entry, pageEntry);
    selectAnnot(id);

    if (startEditing) startTextEdit(entry, textEl);
    return entry;
  }

  function startTextEdit(entry, textEl) {
    var input = document.createElement('textarea');
    input.className = 'annot-text-input';
    input.style.fontSize = entry.fontSize + 'px';
    input.style.color    = entry.color;
    input.value = entry.text;
    textEl.style.visibility = 'hidden';
    entry.el.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      entry.text = input.value;
      textEl.textContent = entry.text;
      textEl.style.visibility = '';
      var lines = entry.text.split('\n');
      var maxLen = lines.reduce(function (m, l) { return Math.max(m, l.length); }, 0);
      entry.wCss = Math.max(60, maxLen * entry.fontSize * 0.62);
      entry.hCss = Math.max(entry.fontSize * 1.7, lines.length * entry.fontSize * 1.4);
      entry.el.style.width  = entry.wCss + 'px';
      entry.el.style.height = entry.hCss + 'px';
      if (input.parentNode) input.parentNode.removeChild(input);
      setStatus('Tekst dodany. Kliknij dwukrotnie, \u017ceby edytowa\u0107.');
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.blur(); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); input.blur(); }
    });
  }

  /* ── Adnotacja: ptaszek / krzyżyk ────────────────────────────────────── */
  function addCheckAnnot(pageEntry, xCss, yCss, sym) {
    var id       = 'a' + (++annotIdCounter);
    var fontSize = state.fontSize * 1.4;
    var size     = fontSize * 1.2;

    var el = makeAnnotEl(id, xCss, yCss, size, size);
    el.classList.add('annot-type-check');

    var symEl = document.createElement('div');
    symEl.className = 'annot-check-el';
    symEl.style.fontSize = fontSize + 'px';
    symEl.style.color    = state.fontColor;
    symEl.textContent    = sym;

    el.appendChild(makeAnnotMove());
    el.appendChild(symEl);
    el.appendChild(makeAnnotResize());
    el.appendChild(makeAnnotDelete());
    pageEntry.annotLayer.appendChild(el);

    var entry = {
      id: id, type: 'check', pageNum: pageEntry.pageNum,
      xCss: xCss, yCss: yCss, wCss: size, hCss: size,
      sym: sym, fontSize: fontSize, color: state.fontColor, el: el,
    };
    state.annots.push(entry);
    bindAnnotEvents(el, entry, pageEntry);
    selectAnnot(id);
    setStatus('Symbol dodany.');
    return entry;
  }

  /* ── Adnotacja: obraz (podpis / parafka / pieczątka) ─────────────────── */
  function addImageAnnot(pageEntry, xCss, yCss, dataUrl, subtype) {
    var id   = 'a' + (++annotIdCounter);
    var defW = subtype === 'stamp' ? 120 : 180;
    var defH = subtype === 'stamp' ? 120 : 60;

    var el = makeAnnotEl(id, xCss, yCss, defW, defH);
    el.classList.add('annot-type-img');

    var img = document.createElement('img');
    img.className = 'annot-img-el';
    img.src = dataUrl;
    img.alt = subtype === 'stamp' ? 'Piecz\u0105tka' :
              subtype === 'initial' ? 'Parafka' : 'Podpis';

    el.appendChild(makeAnnotMove());
    el.appendChild(img);
    el.appendChild(makeAnnotResize());
    el.appendChild(makeAnnotDelete());
    pageEntry.annotLayer.appendChild(el);

    var entry = {
      id: id, type: 'image', subtype: subtype, pageNum: pageEntry.pageNum,
      xCss: xCss, yCss: yCss, wCss: defW, hCss: defH,
      dataUrl: dataUrl, el: el,
    };
    state.annots.push(entry);
    bindAnnotEvents(el, entry, pageEntry);
    selectAnnot(id);
    setStatus(subtype === 'stamp' ? 'Piecz\u0105tka wstawiona.' :
              subtype === 'initial' ? 'Parafka wstawiona.' : 'Podpis wstawiony.');
    return entry;
  }

  /* ── Pomocnicze: budowanie elementów adnotacji ───────────────────────── */
  function makeAnnotEl(id, xCss, yCss, wCss, hCss) {
    var el = document.createElement('div');
    el.className = 'annot';
    el.dataset.id = id;
    el.tabIndex = 0;
    el.style.left   = xCss + 'px';
    el.style.top    = yCss + 'px';
    el.style.width  = wCss + 'px';
    el.style.height = hCss + 'px';
    return el;
  }
  function makeAnnotMove() {
    var d = document.createElement('div');
    d.className = 'annot-move';
    return d;
  }
  function makeAnnotResize() {
    var d = document.createElement('div');
    d.className = 'annot-resize';
    return d;
  }
  function makeAnnotDelete() {
    var btn = document.createElement('button');
    btn.className = 'annot-delete';
    btn.innerHTML = '<span class="ti ti-x" aria-hidden="true"></span>';
    btn.setAttribute('aria-label', 'Usu\u0144 element');
    btn.title = 'Usu\u0144';
    return btn;
  }

  /* ── Zdarzenia adnotacji ─────────────────────────────────────────────── */
  function bindAnnotEvents(el, entry, pageEntry) {
    el.addEventListener('mousedown', function (e) {
      e.stopPropagation();
      selectAnnot(entry.id);
    });

    el.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      if (entry.type === 'text') {
        var textEl = el.querySelector('.annot-text-el');
        if (textEl && !el.querySelector('.annot-text-input')) {
          startTextEdit(entry, textEl);
        }
      }
    });

    var deleteBtn = el.querySelector('.annot-delete');
    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      pushHistory();
      removeAnnot(entry.id);
    });

    /* Przesuwanie — mouse */
    var moveHandle = el.querySelector('.annot-move');
    moveHandle.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      state.dragState = {
        annotId: entry.id,
        startX: e.clientX, startY: e.clientY,
        origX: entry.xCss, origY: entry.yCss,
      };
    });

    /* Przesuwanie — touch */
    moveHandle.addEventListener('touchstart', function (e) {
      e.preventDefault(); e.stopPropagation();
      var t = e.touches[0];
      state.dragState = {
        annotId: entry.id,
        startX: t.clientX, startY: t.clientY,
        origX: entry.xCss, origY: entry.yCss,
      };
    }, { passive: false });

    /* Zmiana rozmiaru — mouse */
    var resizeHandle = el.querySelector('.annot-resize');
    resizeHandle.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      state.resizeState = {
        annotId: entry.id,
        startX: e.clientX, startY: e.clientY,
        origW: entry.wCss, origH: entry.hCss,
      };
    });

    resizeHandle.addEventListener('touchstart', function (e) {
      e.preventDefault(); e.stopPropagation();
      var t = e.touches[0];
      state.resizeState = {
        annotId: entry.id,
        startX: t.clientX, startY: t.clientY,
        origW: entry.wCss, origH: entry.hCss,
      };
    }, { passive: false });

    /* Klawiatura */
    el.addEventListener('keydown', function (e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
          state.selectedId === entry.id &&
          !el.querySelector('.annot-text-input')) {
        e.preventDefault();
        pushHistory();
        removeAnnot(entry.id);
      }
    });
  }

  /* Globalne mouse/touch move + up */
  document.addEventListener('mousemove', function (e) {
    handleDragMove(e.clientX, e.clientY);
  });
  document.addEventListener('mouseup', function () {
    if (state.dragState || state.resizeState) pushHistory();
    state.dragState   = null;
    state.resizeState = null;
  });
  document.addEventListener('touchmove', function (e) {
    if (!state.dragState && !state.resizeState) return;
    var t = e.touches[0];
    handleDragMove(t.clientX, t.clientY);
  }, { passive: true });
  document.addEventListener('touchend', function () {
    if (state.dragState || state.resizeState) pushHistory();
    state.dragState   = null;
    state.resizeState = null;
  });

  function handleDragMove(clientX, clientY) {
    if (state.dragState) {
      var ds    = state.dragState;
      var entry = findAnnotById(ds.annotId);
      if (entry) {
        entry.xCss = ds.origX + (clientX - ds.startX);
        entry.yCss = ds.origY + (clientY - ds.startY);
        entry.el.style.left = entry.xCss + 'px';
        entry.el.style.top  = entry.yCss + 'px';
      }
    }
    if (state.resizeState) {
      var rs    = state.resizeState;
      var entry = findAnnotById(rs.annotId);
      if (entry) {
        entry.wCss = Math.max(20, rs.origW + (clientX - rs.startX));
        entry.hCss = Math.max(10, rs.origH + (clientY - rs.startY));
        entry.el.style.width  = entry.wCss + 'px';
        entry.el.style.height = entry.hCss + 'px';
      }
    }
  }

  /* ── Zaznaczanie / odznaczanie ───────────────────────────────────────── */
  function selectAnnot(id) {
    deselectAll();
    state.selectedId = id;
    var entry = findAnnotById(id);
    if (entry && entry.el) entry.el.classList.add('selected');
  }

  function deselectAll() {
    state.selectedId = null;
    document.querySelectorAll('.annot.selected').forEach(function (el) {
      el.classList.remove('selected');
    });
  }

  function removeAnnot(id) {
    var idx = state.annots.findIndex(function (a) { return a.id === id; });
    if (idx === -1) return;
    var entry = state.annots[idx];
    if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
    state.annots.splice(idx, 1);
    if (state.selectedId === id) state.selectedId = null;
    setStatus('Element usuni\u0119ty. Ctrl+Z cofa operacj\u0119.');
  }

  function findAnnotById(id) {
    for (var i = 0; i < state.annots.length; i++) {
      if (state.annots[i].id === id) return state.annots[i];
    }
    return null;
  }

  /* ── Historia (cofanie) ──────────────────────────────────────────────── */
  function pushHistory() {
    /* Zapisz snapshot: pozycje i rozmiary wszystkich adnotacji */
    var snapshot = state.annots.map(function (a) {
      return {
        id: a.id, type: a.type, subtype: a.subtype, pageNum: a.pageNum,
        xCss: a.xCss, yCss: a.yCss, wCss: a.wCss, hCss: a.hCss,
        text: a.text, fontSize: a.fontSize, color: a.color,
        sym: a.sym, dataUrl: a.dataUrl,
      };
    });
    state.history.push(snapshot);
    if (state.history.length > 50) state.history.shift();
  }

  function undo() {
    if (state.history.length === 0) {
      setStatus('Nie ma nic do cofni\u0119cia.');
      return;
    }
    var snapshot = state.history.pop();

    /* Usuń wszystkie obecne elementy DOM */
    state.annots.forEach(function (a) {
      if (a.el && a.el.parentNode) a.el.parentNode.removeChild(a.el);
    });
    state.annots = [];
    state.selectedId = null;

    /* Odtwórz adnotacje ze snapshotu */
    snapshot.forEach(function (s) {
      var pageEntry = state.pages.find(function (p) { return p.pageNum === s.pageNum; });
      if (!pageEntry) return;
      var entry;
      if (s.type === 'text') {
        entry = addTextAnnot(pageEntry, s.xCss, s.yCss, s.text || '', false);
        entry.fontSize = s.fontSize;
        entry.color    = s.color;
        var textEl = entry.el.querySelector('.annot-text-el');
        if (textEl) {
          textEl.style.fontSize = s.fontSize + 'px';
          textEl.style.color    = s.color;
          textEl.textContent    = s.text || '';
        }
      } else if (s.type === 'check') {
        entry = addCheckAnnot(pageEntry, s.xCss, s.yCss, s.sym || '\u2713');
      } else if (s.type === 'image') {
        entry = addImageAnnot(pageEntry, s.xCss, s.yCss, s.dataUrl, s.subtype || 'sign');
      }
      if (entry) {
        entry.wCss = s.wCss; entry.hCss = s.hCss;
        entry.el.style.width  = s.wCss + 'px';
        entry.el.style.height = s.hCss + 'px';
      }
    });
    deselectAll();
    setStatus('Cofni\u0119to operacj\u0119.');
  }

  /* ── Wykrywanie pól formularza PDF ───────────────────────────────────── */
  function detectFormFields() {
    if (!state.pdfDoc) return;
    state.pdfDoc.getFieldObjects().then(function (fields) {
      if (!fields) return;
      Object.keys(fields).forEach(function (name) {
        var fieldArr = fields[name];
        if (!Array.isArray(fieldArr)) return;
        fieldArr.forEach(function (field) {
          if (!field.rect || !field.page) return;
          var pageNum   = field.page + 1;
          var pageEntry = state.pages.find(function (p) { return p.pageNum === pageNum; });
          if (!pageEntry) return;

          /* rect w PDF: [x1, y1, x2, y2] w punktach, Y od dołu */
          var r = field.rect;
          var scaleX = pageEntry.cssW / pageEntry.pdfW;
          var scaleY = pageEntry.cssH / pageEntry.pdfH;

          var xCss = r[0] * scaleX;
          var yCss = (pageEntry.pdfH - r[3]) * scaleY;
          var wCss = (r[2] - r[0]) * scaleX;
          var hCss = (r[3] - r[1]) * scaleY;

          var hint = document.createElement('div');
          hint.className = 'form-field-hint';
          hint.style.left   = xCss + 'px';
          hint.style.top    = yCss + 'px';
          hint.style.width  = wCss + 'px';
          hint.style.height = hCss + 'px';
          hint.title = 'Pole formularza: ' + name;

          var label = document.createElement('div');
          label.className = 'form-field-hint-label';
          label.textContent = name;
          hint.appendChild(label);

          hint.addEventListener('click', function () {
            hint.remove();
            onLayerClick(xCss, yCss, pageEntry);
          });

          pageEntry.annotLayer.appendChild(hint);
        });
      });
    }).catch(function () { /* brak pól — ignoruj */ });
  }

  /* ── Modal podpisu ───────────────────────────────────────────────────── */
  var SIG_MODAL_TITLES = {
    sign: 'Podpis', initial: 'Parafka', stamp: 'Piecz\u0105tka'
  };
  var SIG_LS_KEYS = {
    sign: LS_KEY_SIG, initial: LS_KEY_INIT, stamp: LS_KEY_STAMP
  };

  function openSignModal(tool) {
    state.activeModalTool = tool;
    signModalTitle.textContent = SIG_MODAL_TITLES[tool] || 'Podpis';
    signModal.hidden = false;
    clearSigCanvas();
    sigPreviewCanvas.hidden = true;
    state.sigPreviewDataUrl = null;
    switchModalTab('draw');

    /* Sprawdź zapisany podpis */
    var lsKey = SIG_LS_KEYS[tool];
    var saved = lsKey ? localStorage.getItem(lsKey) : null;
    savedSigRow.hidden = !saved;
  }

  function closeSignModal() {
    signModal.hidden = true;
    state.pendingInsert = null;
  }

  signModalClose.addEventListener('click', closeSignModal);
  btnSigCancel.addEventListener('click', closeSignModal);

  /* Zamknij po kliknięciu w overlay */
  signModal.addEventListener('click', function (e) {
    if (e.target === signModal) closeSignModal();
  });

  /* Escape zamyka modal */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !signModal.hidden) closeSignModal();
  });

  /* Zakładki */
  tabDraw.addEventListener('click', function () { switchModalTab('draw'); });
  tabUpload.addEventListener('click', function () { switchModalTab('upload'); });

  function switchModalTab(tab) {
    var isDraw = tab === 'draw';
    tabDraw.classList.toggle('active', isDraw);
    tabDraw.setAttribute('aria-selected', isDraw ? 'true' : 'false');
    tabUpload.classList.toggle('active', !isDraw);
    tabUpload.setAttribute('aria-selected', isDraw ? 'false' : 'true');
    paneDraw.hidden   = !isDraw;
    paneUpload.hidden = isDraw;
  }

  /* Potwierdzenie */
  btnSigConfirm.addEventListener('click', function () {
    var dataUrl = getSignatureDataUrl();
    if (!dataUrl) {
      setStatus('Narysuj lub wgraj podpis przed wstawieniem.');
      return;
    }
    if (chkSaveSig.checked) {
      var lsKey = SIG_LS_KEYS[state.activeModalTool];
      if (lsKey) {
        try { localStorage.setItem(lsKey, dataUrl); } catch (e) { /* brak miejsca */ }
      }
    }
    insertSignatureAnnot(dataUrl);
    closeSignModal();
  });

  /* Użyj zapisanego */
  btnUseSaved.addEventListener('click', function () {
    var lsKey = SIG_LS_KEYS[state.activeModalTool];
    var saved = lsKey ? localStorage.getItem(lsKey) : null;
    if (!saved) return;
    insertSignatureAnnot(saved);
    closeSignModal();
  });

  /* Usuń zapisany */
  btnDeleteSaved.addEventListener('click', function () {
    var lsKey = SIG_LS_KEYS[state.activeModalTool];
    if (lsKey) localStorage.removeItem(lsKey);
    savedSigRow.hidden = true;
    setStatus('Zapisany podpis zosta\u0142 usuni\u0119ty z tej przegl\u0105darki.');
  });

  function insertSignatureAnnot(dataUrl) {
    var pi = state.pendingInsert;
    if (!pi) return;
    pushHistory();
    addImageAnnot(pi.pageEntry, pi.xCss, pi.yCss, dataUrl, pi.tool);
    state.pendingInsert = null;
  }

  function getSignatureDataUrl() {
    if (!paneDraw.hidden) {
      if (!state.sigHasData) return null;
      return sigCanvas.toDataURL('image/png');
    } else {
      return state.sigPreviewDataUrl || null;
    }
  }

  /* ── Rysowanie podpisu na canvasie ───────────────────────────────────── */
  function initSigCanvas() {
    var ctx = sigCanvas.getContext('2d');
    var rect = sigCanvas.getBoundingClientRect();
    var dpr  = window.devicePixelRatio || 1;
    sigCanvas.width  = rect.width  * dpr;
    sigCanvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }

  function clearSigCanvas() {
    var ctx = sigCanvas.getContext('2d');
    ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    state.sigHasData = false;
    state.sigDrawing = false;
    sigHint.classList.remove('hidden');
  }

  btnSigClear.addEventListener('click', clearSigCanvas);

  /* Inicjalizacja canvasu przy pierwszym otwarciu modalu */
  var sigCanvasInited = false;
  function ensureSigCanvasInited() {
    if (!sigCanvasInited) {
      initSigCanvas();
      sigCanvasInited = true;
    }
  }

  /* Mouse */
  sigCanvas.addEventListener('mousedown', function (e) {
    ensureSigCanvasInited();
    state.sigDrawing = true;
    sigHint.classList.add('hidden');
    var pos = getSigPos(e);
    var ctx = sigCanvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    state.sigLastX = pos.x;
    state.sigLastY = pos.y;
  });

  sigCanvas.addEventListener('mousemove', function (e) {
    if (!state.sigDrawing) return;
    var pos = getSigPos(e);
    var ctx = sigCanvas.getContext('2d');
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    state.sigLastX = pos.x;
    state.sigLastY = pos.y;
    state.sigHasData = true;
  });

  sigCanvas.addEventListener('mouseup', function () { state.sigDrawing = false; });
  sigCanvas.addEventListener('mouseleave', function () { state.sigDrawing = false; });

  /* Touch */
  sigCanvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    ensureSigCanvasInited();
    state.sigDrawing = true;
    sigHint.classList.add('hidden');
    var pos = getSigPosTouch(e.touches[0]);
    var ctx = sigCanvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }, { passive: false });

  sigCanvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (!state.sigDrawing) return;
    var pos = getSigPosTouch(e.touches[0]);
    var ctx = sigCanvas.getContext('2d');
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    state.sigHasData = true;
  }, { passive: false });

  sigCanvas.addEventListener('touchend', function () { state.sigDrawing = false; });

  function getSigPos(e) {
    var rect = sigCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function getSigPosTouch(t) {
    var rect = sigCanvas.getBoundingClientRect();
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  /* ── Wgrywanie zdjęcia podpisu ───────────────────────────────────────── */
  sigUploadDrop.addEventListener('click', function () { sigImagePicker.click(); });
  sigUploadDrop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sigImagePicker.click(); }
  });
  sigUploadDrop.addEventListener('dragover', function (e) {
    e.preventDefault(); sigUploadDrop.classList.add('over');
  });
  sigUploadDrop.addEventListener('dragleave', function () {
    sigUploadDrop.classList.remove('over');
  });
  sigUploadDrop.addEventListener('drop', function (e) {
    e.preventDefault(); sigUploadDrop.classList.remove('over');
    var files = Array.from(e.dataTransfer.files);
    if (files.length) loadSigImage(files[0]);
  });
  sigImagePicker.addEventListener('change', function () {
    if (sigImagePicker.files.length) loadSigImage(sigImagePicker.files[0]);
    sigImagePicker.value = '';
  });

  function loadSigImage(file) {
    if (!file.type.startsWith('image/')) {
      setStatus('Obs\u0142ugiwane s\u0105 tylko pliki graficzne (PNG, JPG, itp.).');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        /* Usuń białe tło → przezroczystość */
        var offscreen = document.createElement('canvas');
        offscreen.width  = img.width;
        offscreen.height = img.height;
        var ctx = offscreen.getContext('2d');
        ctx.drawImage(img, 0, 0);
        removeWhiteBackground(ctx, offscreen.width, offscreen.height);

        var dataUrl = offscreen.toDataURL('image/png');
        state.sigPreviewDataUrl = dataUrl;

        /* Pokaż podgląd */
        sigPreviewCanvas.hidden = false;
        sigPreviewCanvas.width  = offscreen.width;
        sigPreviewCanvas.height = offscreen.height;
        var pCtx = sigPreviewCanvas.getContext('2d');
        pCtx.clearRect(0, 0, sigPreviewCanvas.width, sigPreviewCanvas.height);
        pCtx.drawImage(offscreen, 0, 0);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /**
   * Zamienia piksele bliskie białemu na przezroczyste.
   * Próg: kanały R,G,B > 230 → alpha = 0.
   */
  function removeWhiteBackground(ctx, w, h) {
    var imageData = ctx.getImageData(0, 0, w, h);
    var data = imageData.data;
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 230 && g > 230 && b > 230) {
        data[i + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  /* ── Pobieranie gotowego PDF ─────────────────────────────────────────── */
  function downloadPdf() {
    if (!state.pdfBytes || state.annots.length === 0) {
      if (!state.pdfBytes) {
        setStatus('Najpierw wgraj plik PDF.');
        return;
      }
      /* Brak adnotacji — pobierz oryginał */
      downloadBytes(state.pdfBytes, outFileName());
      return;
    }

    btnDownload.disabled = true;
    setStatus('Generuj\u0119 plik\u2026');

    var PDFLib = window.PDFLib;
    if (!PDFLib) {
      setStatus('B\u0142\u0105d: biblioteka pdf-lib nie jest dost\u0119pna.');
      btnDownload.disabled = false;
      return;
    }

    /* Przekazujemy kopię state.pdfBytes — pdf-lib modyfikuje bufor wewnętrznie */
    PDFLib.PDFDocument.load(state.pdfBytes.slice(0)).then(function (pdfDoc) {
      /* Pobierz czcionkę obsługującą polskie znaki */
      return loadPolishFont(PDFLib).then(function (fontBytes) {
        return { pdfDoc: pdfDoc, fontBytes: fontBytes };
      });
    }).then(function (ctx) {
      var pdfDoc    = ctx.pdfDoc;
      var fontBytes = ctx.fontBytes;

      /* Osadź czcionkę */
      var fontPromise = fontBytes
        ? pdfDoc.embedFont(fontBytes)
        : pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

      return fontPromise.then(function (font) {
        return { pdfDoc: pdfDoc, font: font };
      });
    }).then(function (ctx) {
      var pdfDoc = ctx.pdfDoc;
      var font   = ctx.font;
      var pages  = pdfDoc.getPages();

      /* Zbierz obietnice osadzania obrazów */
      var imagePromises = state.annots
        .filter(function (a) { return a.type === 'image'; })
        .map(function (a) {
          var base64 = a.dataUrl.split(',')[1];
          var bytes  = base64ToUint8Array(base64);
          var isPng  = a.dataUrl.indexOf('image/png') !== -1;
          return (isPng ? pdfDoc.embedPng(bytes) : pdfDoc.embedJpg(bytes))
            .then(function (img) { return { annot: a, img: img }; });
        });

      return Promise.all(imagePromises).then(function (imgResults) {
        var imgMap = {};
        imgResults.forEach(function (r) { imgMap[r.annot.id] = r.img; });

        state.annots.forEach(function (annot) {
          var pageIdx = annot.pageNum - 1;
          if (pageIdx < 0 || pageIdx >= pages.length) return;
          var page    = pages[pageIdx];
          var pdfSize = page.getSize();

          /* Przelicz współrzędne CSS → PDF */
          var pageEntry = state.pages.find(function (p) { return p.pageNum === annot.pageNum; });
          if (!pageEntry) return;

          var pos  = cssToPdf(pageEntry, annot.xCss, annot.yCss);
          var size = cssSizeToPdf(pageEntry, annot.wCss, annot.hCss);

          if (annot.type === 'text' || annot.type === 'check') {
            var textContent = annot.type === 'text' ? (annot.text || '') : (annot.sym || '\u2713');
            var pdfFontSize = (annot.fontSize || 12) * (pageEntry.pdfH / pageEntry.cssH);
            var rgb = hexToRgb(annot.color || '#000000');

            /* Rysuj każdą linię osobno */
            var lines = textContent.split('\n');
            var lineH = pdfFontSize * 1.3;
            lines.forEach(function (line, li) {
              if (!line) return;
              try {
                page.drawText(line, {
                  x:        pos.x,
                  y:        pos.y - li * lineH,
                  size:     pdfFontSize,
                  font:     font,
                  color:    PDFLib.rgb(rgb.r / 255, rgb.g / 255, rgb.b / 255),
                  maxWidth: size.w,
                });
              } catch (e) { /* ignoruj błędy pojedynczych znaków */ }
            });

          } else if (annot.type === 'image') {
            var embeddedImg = imgMap[annot.id];
            if (!embeddedImg) return;
            page.drawImage(embeddedImg, {
              x:      pos.x,
              y:      pos.y - size.h,   /* pdf-lib: y to lewy-dolny róg */
              width:  size.w,
              height: size.h,
            });
          }
        });

        return pdfDoc.save();
      });
    }).then(function (bytes) {
      downloadBytes(bytes, outFileName());
      setStatus('Plik pobrany \u2014 ' + state.annots.length + ' element\u00f3w wtopionych w dokument.');
      btnDownload.disabled = false;
    }).catch(function (err) {
      console.error('[sign] b\u0142\u0105d generowania PDF:', err);
      setStatus('Nie uda\u0142o si\u0119 wygenerowa\u0107 pliku. Spr\u00f3buj od\u015bwie\u017cy\u0107 stron\u0119 i wgra\u0107 dokument ponownie.');
      btnDownload.disabled = false;
    });
  }

  /**
   * Próbuje pobrać czcionkę NotoSans obsługującą polskie znaki.
   * Jeśli się nie uda (offline), zwraca null → fallback na Helvetica.
   */
  function loadPolishFont(PDFLib) {
    var url = 'https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRASf6M7Q.woff2';
    /* Próbujemy pobrać TTF (woff2 nie jest obsługiwany przez pdf-lib) */
    var ttfUrl = 'https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr6TRG_f6M7bev.ttf';
    return fetch(ttfUrl)
      .then(function (r) {
        if (!r.ok) throw new Error('font fetch failed');
        return r.arrayBuffer();
      })
      .then(function (buf) { return new Uint8Array(buf); })
      .catch(function () { return null; });
  }

  /* ── Pomocnicze ──────────────────────────────────────────────────────── */
  function outFileName() {
    var base = state.fileName.replace(/\.pdf$/i, '');
    return base + '-podpisany.pdf';
  }

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

  function base64ToUint8Array(base64) {
    var binary = atob(base64);
    var bytes  = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function hexToRgb(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return { r: r, g: g, b: b };
  }

  function formatDate(d) {
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yy = d.getFullYear();
    return dd + '.' + mm + '.' + yy;
  }

  function classifyPdfError(err) {
    var msg = (err && err.message) ? err.message.toLowerCase() : '';
    if (msg.indexOf('password') !== -1 || msg.indexOf('encrypted') !== -1) {
      return 'Plik jest zabezpieczony has\u0142em. Usu\u0144 ochron\u0119 przed podpisaniem.';
    }
    if (msg.indexOf('invalid pdf') !== -1 || msg.indexOf('missing pdf') !== -1 ||
        msg.indexOf('unexpected') !== -1) {
      return 'Plik jest uszkodzony lub nie jest prawid\u0142owym dokumentem PDF.';
    }
    return 'Nie uda\u0142o si\u0119 otworzy\u0107 pliku PDF. Sprawd\u017a, czy plik nie jest uszkodzony lub zaszyfrowany.';
  }

  /* ── UI helpers ──────────────────────────────────────────────────────── */
  function showProgress(visible, ratio, label) {
    loadProgress.hidden = !visible;
    if (visible && ratio !== undefined) {
      lpFill.style.width  = Math.round(ratio * 100) + '%';
      lpLabel.textContent = label || '';
    }
  }

  function setStatus(msg) {
    statusText.textContent = msg;
  }

  function showError(fileName, message) {
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
    errorsList.appendChild(item);
  }

  function clearErrors() {
    errorsList.innerHTML = '';
  }

  function resetAll() {
    state.pdfDoc    = null;
    state.pdfBytes  = null;
    state.fileName  = '';
    state.pages     = [];
    state.annots    = [];
    state.history   = [];
    state.selectedId = null;
    pagesInner.innerHTML = '';
    workspace.hidden = true;
    clearErrors();
    setStatus('Kliknij w dokument, \u017ceby doda\u0107 element.');
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();