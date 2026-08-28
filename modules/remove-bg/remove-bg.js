/**
 * remove-bg.js – Usuwanie tła ze zdjęć
 * @imgly/background-removal przez ESM CDN.
 * Model (~50MB) pobierany raz, potem cached.
 * Wszystko lokalnie w przeglądarce.
 */

import { removeBackground } from 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';

(function () {
  'use strict';

  /* ── Stan ─────────────────────────────────────────────────────────── */
  var sourceFile       = null;
  var originalFileName = null;
  var resultBlob       = null;
  var errorBox         = null;

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var dropzone    = document.getElementById('dropzone');
  var picker      = document.getElementById('picker');
  var workspace   = document.getElementById('workspace');
  var rbProgress  = document.getElementById('rbProgress');
  var rbFill      = document.getElementById('rbFill');
  var rbLabel     = document.getElementById('rbLabel');
  var rbViewer    = document.getElementById('rbViewer');
  var origImg     = document.getElementById('origImg');
  var resultImg   = document.getElementById('resultImg');
  var btnRemove   = document.getElementById('btnRemove');
  var btnDownload = document.getElementById('btnDownload');
  var btnChangeFile = document.getElementById('btnChangeFile');
  var saveInfo    = document.getElementById('saveInfo');

  /* Blokuj domyślne otwieranie pliku przez przeglądarkę */
  document.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); });

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

  btnRemove.addEventListener('click', runRemoveBg);
  btnDownload.addEventListener('click', downloadResult);
  btnChangeFile.addEventListener('click', function () { picker.click(); });

  /* ── Obsługa pliku ────────────────────────────────────────────────── */
  function handleFiles(files) {
    var img = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/')) { img = files[i]; break; }
    }
    if (!img) { showError('Dodaj plik graficzny (JPG, PNG, WebP).'); return; }
    loadFile(img);
  }

  function loadFile(file) {
    sourceFile       = file;
    originalFileName = file.name;
    resultBlob       = null;
    btnDownload.disabled = true;
    saveInfo.textContent = '';
    rbViewer.hidden = true;
    rbProgress.style.display = 'none';

    var url = URL.createObjectURL(file);
    origImg.src = url;
    origImg.onload = function () { URL.revokeObjectURL(url); };

    dropzone.style.display = 'none';
    workspace.hidden = false;
  }

  /* ── Usuwanie tła ─────────────────────────────────────────────────── */
  function runRemoveBg() {
    if (!sourceFile) return;
    btnRemove.disabled   = true;
    btnDownload.disabled = true;
    saveInfo.textContent = '';
    rbProgress.style.display = 'flex';
    rbViewer.hidden = true;

    setProgress(0, 'Inicjalizuję model…');

    var config = {
      progress: function (key, current, total) {
        if (total > 0) {
          var pct = current / total;
          if (key === 'fetch:model') {
            setProgress(pct * 0.7, 'Pobieram model AI… ' + Math.round(pct * 100) + '%');
          } else {
            setProgress(0.7 + pct * 0.3, 'Przetwarzam zdjęcie…');
          }
        }
      }
    };

    removeBackground(sourceFile, config).then(function (blob) {
      resultBlob = blob;
      var url = URL.createObjectURL(blob);
      resultImg.src = url;
      resultImg.onload = function () { URL.revokeObjectURL(url); };

      rbProgress.style.display = 'none';
      rbViewer.hidden = false;
      btnRemove.disabled   = false;
      btnDownload.disabled = false;
      saveInfo.textContent = 'Gotowe · pobierz PNG z przezroczystym tłem';
    }).catch(function (err) {
      rbProgress.style.display = 'none';
      rbViewer.hidden = true;
      btnRemove.disabled = false;
      saveInfo.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany');
    });
  }

  /* ── Postęp ───────────────────────────────────────────────────────── */
  function setProgress(ratio, label) {
    rbFill.style.width  = Math.round(Math.min(ratio, 1) * 100) + '%';
    rbLabel.textContent = label || '';
  }

  /* ── Pobieranie ───────────────────────────────────────────────────── */
  function downloadResult() {
    if (!resultBlob) return;
    var dot  = originalFileName ? originalFileName.lastIndexOf('.') : -1;
    var base = (dot !== -1) ? originalFileName.substring(0, dot) : (originalFileName || 'obraz');
    var url  = URL.createObjectURL(resultBlob);
    var a    = document.createElement('a');
    a.href = url; a.download = base + '-bez-tla.png';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  /* ── Błędy ────────────────────────────────────────────────────────── */
  function showError(message) {
    if (!errorBox) {
      errorBox = document.createElement('div');
      errorBox.className = 'file-error';
      errorBox.setAttribute('role', 'alert');
      dropzone.parentNode.insertBefore(errorBox, dropzone.nextSibling);
    }
    errorBox.hidden = false;
    errorBox.innerHTML =
      '<span class="ti ti-alert-circle" aria-hidden="true"></span>' +
      '<div class="file-error-body"><div class="file-error-msg">' + escHtml(message) + '</div></div>' +
      '<button class="file-error-close" aria-label="Zamknij">' +
        '<span class="ti ti-x" aria-hidden="true"></span></button>';
    errorBox.querySelector('.file-error-close').addEventListener('click', function () {
      errorBox.hidden = true;
    });
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
