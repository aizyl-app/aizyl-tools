/**
 * page-numbers.js — Numery stron PDF
 * Dodaje numery stron przez pdf-lib.
 * Opcje: pozycja, prefiks, start, pomiń pierwszą, rozmiar, kolor, margines.
 */
(function () {
  'use strict';

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var fileName   = '';
  var fileBytes  = null;
  var errorsList = null;
  var vertPos    = 'bottom';
  var horizPos   = 'center';

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone       = document.getElementById('dropzone');
  var picker         = document.getElementById('picker');
  var workspace      = document.getElementById('workspace');
  var fileInfo       = document.getElementById('fileInfo');
  var inputPrefix    = document.getElementById('inputPrefix');
  var inputStartNum  = document.getElementById('inputStartNum');
  var inputSkipFirst = document.getElementById('inputSkipFirst');
  var inputSize      = document.getElementById('inputSize');
  var inputColor     = document.getElementById('inputColor');
  var inputMargin    = document.getElementById('inputMargin');
  var valSize        = document.getElementById('valSize');
  var valMargin      = document.getElementById('valMargin');
  var btnApply       = document.getElementById('btnApply');
  var btnNewFile     = document.getElementById('btnNewFile');
  var actionStatus   = document.getElementById('actionStatus');

  /* ── Suwaki ───────────────────────────────────────────────────────── */
  inputSize.addEventListener('input', function () { valSize.textContent = inputSize.value; });
  inputMargin.addEventListener('input', function () { valMargin.textContent = inputMargin.value; });

  /* ── Przyciski pozycji ────────────────────────────────────────────── */
  document.querySelectorAll('.pos-btn[data-vert]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.pos-btn[data-vert]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      vertPos = btn.dataset.vert;
    });
  });

  document.querySelectorAll('.pos-btn[data-horiz]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.pos-btn[data-horiz]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      horizPos = btn.dataset.horiz;
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
  btnNewFile.addEventListener('click', function () { picker.click(); });
  btnApply.addEventListener('click', runApply);

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
      actionStatus.textContent = '';
      showWorkspace(file);
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

  /* ── Dodawanie numerów ────────────────────────────────────────────── */
  function runApply() {
    if (!fileBytes) return;

    var fontSize   = parseInt(inputSize.value, 10);
    var margin     = parseInt(inputMargin.value, 10);
    var startNum   = Math.max(1, parseInt(inputStartNum.value, 10) || 1);
    var skipFirst  = inputSkipFirst.checked;
    var prefix     = inputPrefix.value;
    var color      = hexToRgb(inputColor.value);

    setBusy(true);
    actionStatus.textContent = 'Dodaję numery stron...';

    var PDFLib = window.PDFLib;
    if (!PDFLib) {
      actionStatus.textContent = 'Błąd: pdf-lib niedostępna.';
      setBusy(false);
      return;
    }

    PDFLib.PDFDocument.load(fileBytes, { ignoreEncryption: true })
      .then(function (pdfDoc) {
        return pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (font) {
          var pages = pdfDoc.getPages();

          pages.forEach(function (page, idx) {
            if (skipFirst && idx === 0) return;

            var w      = page.getWidth();
            var h      = page.getHeight();
            var label  = prefix + (startNum + idx);
            var tw     = font.widthOfTextAtSize(label, fontSize);

            var x;
            if (horizPos === 'left')   x = margin;
            else if (horizPos === 'right') x = w - tw - margin;
            else x = (w - tw) / 2;

            var y;
            if (vertPos === 'bottom') y = margin;
            else y = h - fontSize - margin;

            page.drawText(label, {
              x: x, y: y,
              size: fontSize,
              font: font,
              color: PDFLib.rgb(color.r, color.g, color.b)
            });
          });

          return pdfDoc.save();
        });
      })
      .then(function (bytes) {
        var baseName = fileName.replace(/\.pdf$/i, '');
        downloadBlob(
          new Blob([bytes], { type: 'application/pdf' }),
          baseName + '-numerowany.pdf'
        );
        actionStatus.textContent = 'Pobrano.';
      })
      .catch(function (err) {
        actionStatus.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany błąd');
      })
      .then(function () { setBusy(false); });
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
