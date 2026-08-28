/**
 * split-file.js - Podzial pliku na czesci
 * Zero zaleznosci. Blob.slice() + sekwencyjne pobieranie. Wszystko lokalnie.
 */
(function () {
  'use strict';

  var activeMb     = 10;
  var fileObj      = null;
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var fileInfo     = document.getElementById('fileInfo');
  var splitInfo    = document.getElementById('splitInfo');
  var customMb     = document.getElementById('customMb');
  var btnSplit     = document.getElementById('btnSplit');
  var btnNewFile   = document.getElementById('btnNewFile');
  var loadProgress = document.getElementById('loadProgress');
  var lpFill       = document.getElementById('lpFill');
  var lpLabel      = document.getElementById('lpLabel');

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
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  picker.addEventListener('change', function () {
    if (picker.files[0]) handleFile(picker.files[0]);
    picker.value = '';
  });

  function handleFile(f) {
    fileObj = f;
    fileInfo.innerHTML =
      '<span class="ti ti-file"></span> ' +
      '<strong>' + esc(f.name) + '</strong>' +
      ' <span class="fi-size">(' + fmtSize(f.size) + ')</span>';
    dropzone.hidden  = true;
    workspace.hidden = false;
    updateInfo();
  }

  function getChunkBytes() {
    var custom = parseInt(customMb.value, 10);
    if (custom > 0) return custom * 1024 * 1024;
    return activeMb * 1024 * 1024;
  }

  function updateInfo() {
    if (!fileObj) return;
    var chunkBytes = getChunkBytes();
    var parts = Math.ceil(fileObj.size / chunkBytes);
    splitInfo.innerHTML =
      'Plik zostanie podzielony na <strong>' + parts + '</strong> ' + pluralParts(parts) +
      ' po maksymalnie <strong>' + fmtSize(chunkBytes) + '</strong> kazdej.';
  }

  document.querySelectorAll('[data-mb]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-mb]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeMb = parseInt(btn.dataset.mb, 10);
      customMb.value = '';
      updateInfo();
    });
  });

  customMb.addEventListener('input', function () {
    document.querySelectorAll('[data-mb]').forEach(function (b) { b.classList.remove('active'); });
    updateInfo();
  });

  btnSplit.addEventListener('click', function () {
    if (!fileObj) return;
    var chunkBytes = getChunkBytes();
    if (chunkBytes <= 0) { alert('Podaj prawidlowy rozmiar czesci.'); return; }
    var parts = Math.ceil(fileObj.size / chunkBytes);
    if (parts < 2) { alert('Plik jest mniejszy niz wybrany rozmiar czesci.'); return; }

    btnSplit.disabled   = true;
    loadProgress.hidden = false;
    lpFill.style.width  = '0%';
    lpLabel.textContent = 'Przygotowuje czesci...';

    var baseName = fileObj.name;
    var pad      = String(parts).length;

    function downloadPart(i) {
      if (i >= parts) {
        lpFill.style.width  = '100%';
        loadProgress.hidden = true;
        btnSplit.disabled   = false;
        return;
      }
      var start  = i * chunkBytes;
      var end    = Math.min(start + chunkBytes, fileObj.size);
      var chunk  = fileObj.slice(start, end);
      var num    = String(i + 1).padStart(pad, '0');
      var name   = baseName + '.part' + num;
      var url    = URL.createObjectURL(chunk);
      var a      = document.createElement('a');
      a.href     = url;
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);

      lpFill.style.width  = Math.round(((i + 1) / parts) * 100) + '%';
      lpLabel.textContent = 'Pobrano czesc ' + (i + 1) + ' z ' + parts + '...';

      setTimeout(function () { downloadPart(i + 1); }, 400);
    }

    downloadPart(0);
  });

  btnNewFile.addEventListener('click', function () {
    fileObj = null;
    dropzone.hidden     = false;
    workspace.hidden    = true;
    loadProgress.hidden = true;
    btnSplit.disabled   = false;
    customMb.value      = '';
  });

  function pluralParts(n) {
    if (n === 1) return 'czesc';
    if (n >= 2 && n <= 4) return 'czesci';
    return 'czesci';
  }

  function fmtSize(bytes) {
    if (bytes < 1024)    return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
  }
})();
