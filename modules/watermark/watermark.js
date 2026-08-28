/**
 * watermark.js — Znak wodny PDF
 * Nakłada tekst na wybrane strony przez pdf-lib.
 * Podgląd: offscreen canvas + debounce, bez migania.
 * Presety: localStorage.
 */
(function () {
  'use strict';

  var PREVIEW_SCALE = 1.2;

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var fileName    = '';
  var fileBytes   = null;
  var errorsList  = null;
  var offscreen   = null;
  var renderTimer = null;
  var totalPages  = 0;

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone        = document.getElementById('dropzone');
  var picker          = document.getElementById('picker');
  var workspace       = document.getElementById('workspace');
  var fileInfo        = document.getElementById('fileInfo');
  var inputText       = document.getElementById('inputText');
  var inputColor      = document.getElementById('inputColor');
  var inputSize       = document.getElementById('inputSize');
  var inputOpacity    = document.getElementById('inputOpacity');
  var inputAngle      = document.getElementById('inputAngle');
  var inputX          = document.getElementById('inputX');
  var inputY          = document.getElementById('inputY');
  var valSize         = document.getElementById('valSize');
  var valOpacity      = document.getElementById('valOpacity');
  var valAngle        = document.getElementById('valAngle');
  var valX            = document.getElementById('valX');
  var valY            = document.getElementById('valY');
  var btnApply        = document.getElementById('btnApply');
  var btnNewFile      = document.getElementById('btnNewFile');
  var actionStatus    = document.getElementById('actionStatus');
  var previewWrap     = document.getElementById('previewWrap');
  var previewCanvas   = document.getElementById('previewCanvas');
  var pageMode        = document.getElementsByName('pageMode');
  var inputPageNum    = document.getElementById('inputPageNum');
  var btnSavePreset   = document.getElementById('btnSavePreset');
  var inputPresetName = document.getElementById('inputPresetName');
  var presetList      = document.getElementById('presetList');

  /* ── Suwaki ───────────────────────────────────────────────────────── */
  function bindSlider(input, valEl, suffix) {
    input.addEventListener('input', function () {
      valEl.textContent = input.value + (suffix || '');
      schedulePreview();
    });
  }
  bindSlider(inputSize,    valSize,    '');
  bindSlider(inputOpacity, valOpacity, '%');
  bindSlider(inputAngle,   valAngle,   '°');
  bindSlider(inputX,       valX,       '%');
  bindSlider(inputY,       valY,       '%');
  inputText.addEventListener('input',  schedulePreview);
  inputColor.addEventListener('input', schedulePreview);

  /* ── Dropzone ─────────────────────────────────────────────────────── */
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
  btnNewFile.addEventListener('click', function () { picker.click(); });
  btnApply.addEventListener('click', runApply);

  /* ── Wybór stron ──────────────────────────────────────────────────── */
  Array.from(pageMode).forEach(function (radio) {
    radio.addEventListener('change', function () {
      inputPageNum.disabled = radio.value !== 'custom';
    });
  });

  /* ── Presety ──────────────────────────────────────────────────────── */
  btnSavePreset.addEventListener('click', savePreset);
  loadPresetList();

  /* ── Obsługa pliku ────────────────────────────────────────────────── */
  function handleFiles(files) {
    var pdf = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].type === 'application/pdf' || files[i].name.toLowerCase().endsWith('.pdf')) {
        pdf = files[i]; break;
      }
    }
    if (!pdf) {
      showError(files[0] ? files[0].name : 'plik', 'Obsługiwane są wyłącznie pliki .pdf.');
      return;
    }
    loadFile(pdf);
  }

  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      fileBytes = new Uint8Array(e.target.result);
      fileName  = file.name;
      offscreen = null;
      actionStatus.textContent = '';
      showWorkspace(file);

      if (typeof pdfjsLib === 'undefined') return;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      pdfjsLib.getDocument({ data: fileBytes.slice() }).promise.then(function (doc) {
        totalPages = doc.numPages;
        inputPageNum.max         = totalPages;
        inputPageNum.placeholder = '1-' + totalPages;
        return doc.getPage(1);
      }).then(function (page) {
        var vp = page.getViewport({ scale: PREVIEW_SCALE });
        offscreen        = document.createElement('canvas');
        offscreen.width  = Math.round(vp.width);
        offscreen.height = Math.round(vp.height);
        return page.render({ canvasContext: offscreen.getContext('2d'), viewport: vp }).promise;
      }).then(function () {
        previewWrap.hidden = false;
        renderPreview();
      }).catch(function () {});
    };
    reader.onerror = function () {
      showError(file.name, 'Nie udało się odczytać pliku. Sprawdź, czy plik nie jest uszkodzony.');
    };
    reader.readAsArrayBuffer(file);
  }

  function showWorkspace(file) {
    var kb   = Math.round(file.size / 1024);
    var size = kb < 1024 ? kb + ' KB' : (kb / 1024).toFixed(1) + ' MB';
    fileInfo.innerHTML =
      '<span class="ti ti-file-type-pdf" aria-hidden="true"></span>' +
      '<span class="file-info-name">' + escHtml(file.name) + '</span>' +
      '<span class="file-info-size">' + size + '</span>';
    workspace.hidden = false;
  }

  /* ── Podgląd z debouncingiem ──────────────────────────────────────── */
  function schedulePreview() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 60);
  }

  function renderPreview() {
    if (!offscreen) return;
    var w = offscreen.width;
    var h = offscreen.height;

    previewCanvas.width  = w;
    previewCanvas.height = h;

    var ctx = previewCanvas.getContext('2d');
    ctx.drawImage(offscreen, 0, 0);

    var text     = inputText.value.trim() || ' ';
    var fontSize = parseInt(inputSize.value, 10) * PREVIEW_SCALE;
    var opacity  = parseInt(inputOpacity.value, 10) / 100;
    var angle    = parseInt(inputAngle.value, 10);
    var color    = inputColor.value;
    var xPct     = parseInt(inputX.value, 10) / 100;
    var yPct     = parseInt(inputY.value, 10) / 100;

    ctx.save();
    ctx.globalAlpha   = opacity;
    ctx.fillStyle     = color;
    ctx.font          = 'bold ' + fontSize + 'px Helvetica, Arial, sans-serif';
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'middle';
    ctx.translate(w * xPct, h * yPct);
    ctx.rotate(angle * Math.PI / 180);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /* ── Nakładanie znaku wodnego ─────────────────────────────────────── */
  function runApply() {
    if (!fileBytes) return;
    var text = inputText.value.trim();
    if (!text) { inputText.focus(); return; }

    var fontSize = parseInt(inputSize.value, 10);
    var opacity  = parseInt(inputOpacity.value, 10) / 100;
    var angle    = parseInt(inputAngle.value, 10);
    var color    = hexToRgb(inputColor.value);
    var xPct     = parseInt(inputX.value, 10) / 100;
    var yPct     = parseInt(inputY.value, 10) / 100;
    var mode     = getPageMode();

    setBusy(true);
    actionStatus.textContent = 'Nakładam znak wodny...';

    var PDFLib = window.PDFLib;
    if (!PDFLib) {
      actionStatus.textContent = 'Błąd: pdf-lib niedostępna.';
      setBusy(false);
      return;
    }

    PDFLib.PDFDocument.load(fileBytes, { ignoreEncryption: true })
      .then(function (pdfDoc) {
        return pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (font) {
          var pages     = pdfDoc.getPages();
          var rad       = angle * Math.PI / 180;
          var textWidth = font.widthOfTextAtSize(text, fontSize);
          var customIdx = parseInt(inputPageNum.value, 10) - 1;

          pages.forEach(function (page, idx) {
            if (mode === 'first'  && idx !== 0)         return;
            if (mode === 'custom' && idx !== customIdx)  return;

            var w  = page.getWidth();
            var h  = page.getHeight();
            var cx = w * xPct;
            var cy = h * (1 - yPct);

            var x = cx - (textWidth / 2) * Math.cos(rad) - (fontSize / 2) * Math.sin(rad);
            var y = cy + (textWidth / 2) * Math.sin(rad) - (fontSize / 2) * Math.cos(rad);

            page.drawText(text, {
              x: x, y: y, size: fontSize, font: font,
              color:   PDFLib.rgb(color.r, color.g, color.b),
              opacity: opacity,
              rotate:  PDFLib.degrees(-angle)
            });
          });

          return pdfDoc.save();
        });
      })
      .then(function (bytes) {
        var baseName = fileName.replace(/\.pdf$/i, '');
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), baseName + '-watermark.pdf');
        actionStatus.textContent = 'Pobrano.';
      })
      .catch(function (err) {
        actionStatus.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany błąd');
      })
      .then(function () { setBusy(false); });
  }

  function getPageMode() {
    for (var i = 0; i < pageMode.length; i++) {
      if (pageMode[i].checked) return pageMode[i].value;
    }
    return 'all';
  }

  /* ── Presety ──────────────────────────────────────────────────────── */
  function getPresets() {
    try { return JSON.parse(localStorage.getItem('watermark_presets') || '[]'); }
    catch (e) { return []; }
  }

  function savePreset() {
    var name = inputPresetName.value.trim();
    if (!name) { inputPresetName.focus(); return; }
    var presets = getPresets();
    presets.unshift({
      name:    name,
      text:    inputText.value,
      color:   inputColor.value,
      size:    inputSize.value,
      opacity: inputOpacity.value,
      angle:   inputAngle.value,
      x:       inputX.value,
      y:       inputY.value
    });
    localStorage.setItem('watermark_presets', JSON.stringify(presets));
    inputPresetName.value = '';
    loadPresetList();
  }

  function applyPreset(preset) {
    inputText.value    = preset.text;
    inputColor.value   = preset.color;
    inputSize.value    = preset.size;    valSize.textContent    = preset.size;
    inputOpacity.value = preset.opacity; valOpacity.textContent = preset.opacity + '%';
    inputAngle.value   = preset.angle;   valAngle.textContent   = preset.angle + '°';
    inputX.value       = preset.x;       valX.textContent       = preset.x + '%';
    inputY.value       = preset.y;       valY.textContent       = preset.y + '%';
    renderPreview();
  }

  function deletePreset(idx) {
    var presets = getPresets();
    presets.splice(idx, 1);
    localStorage.setItem('watermark_presets', JSON.stringify(presets));
    loadPresetList();
  }

  function loadPresetList() {
    var presets = getPresets();
    if (presets.length === 0) {
      presetList.innerHTML = '<p class="presets-empty">Brak zapisanych presetów.</p>';
      return;
    }
    presetList.innerHTML = presets.map(function (p, i) {
      return '<div class="preset-item">' +
        '<span class="preset-name">' + escHtml(p.name) + '</span>' +
        '<span class="preset-preview-text">' + escHtml(p.text) + '</span>' +
        '<button class="preset-load" data-idx="' + i + '">Wczytaj</button>' +
        '<button class="preset-delete" data-idx="' + i + '" aria-label="Usuń preset">' +
          '<span class="ti ti-trash"></span>' +
        '</button>' +
      '</div>';
    }).join('');

    presetList.querySelectorAll('.preset-load').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyPreset(getPresets()[+btn.dataset.idx]);
      });
    });
    presetList.querySelectorAll('.preset-delete').forEach(function (btn) {
      btn.addEventListener('click', function () { deletePreset(+btn.dataset.idx); });
    });
  }

  /* ── Pomocnicze ───────────────────────────────────────────────────── */
  function hexToRgb(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16) / 255,
      g: parseInt(hex.slice(3, 5), 16) / 255,
      b: parseInt(hex.slice(5, 7), 16) / 255
    };
  }

  function setBusy(busy) {
    btnApply.disabled   = busy;
    btnNewFile.disabled = busy;
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

  function showError(name, message) {
    var list = ensureErrorsList();
    var item = document.createElement('div');
    item.className = 'file-error';
    item.setAttribute('role', 'alert');
    item.innerHTML =
      '<span class="ti ti-alert-circle" aria-hidden="true"></span>' +
      '<div class="file-error-body">' +
        '<div class="file-error-name">' + escHtml(name)    + '</div>' +
        '<div class="file-error-msg">'  + escHtml(message) + '</div>' +
      '</div>' +
      '<button class="file-error-close" aria-label="Zamknij">' +
        '<span class="ti ti-x"></span>' +
      '</button>';
    item.querySelector('.file-error-close').addEventListener('click', function () { item.remove(); });
    list.appendChild(item);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
