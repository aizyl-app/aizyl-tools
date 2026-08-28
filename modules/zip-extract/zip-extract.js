/**
 * zip-extract.js - Rozpakowywanie archiwum ZIP
 * JSZip@3.10.1 z CDN. Wszystko lokalnie w przegladarce.
 */
(function () {
  'use strict';

  var zipData      = null;
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var fileInfo     = document.getElementById('fileInfo');
  var fileList     = document.getElementById('fileList');
  var listLabel    = document.getElementById('listLabel');
  var btnExtractAll = null;
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
    if (!f.name.toLowerCase().endsWith('.zip')) {
      alert('Wybierz plik .zip.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (ev) {
      JSZip.loadAsync(ev.target.result).then(function (zip) {
        zipData = zip;
        var entries = [];
        zip.forEach(function (path, entry) { entries.push({ path: path, entry: entry }); });
        var files = entries.filter(function (e) { return !e.entry.dir; });
        var total = entries.reduce(function (s, e) {
          return s + (e.entry._data ? (e.entry._data.uncompressedSize || 0) : 0);
        }, 0);
        fileInfo.innerHTML =
          '<span class="ti ti-archive"></span> ' +
          '<strong>' + esc(f.name) + '</strong>' +
          ' <span class="fi-size">(' + fmtSize(f.size) + ', ' + files.length + ' plikow)</span>';
        listLabel.textContent = 'Zawartosc archiwum (' + files.length + ' plikow)';
        renderList(entries);
        dropzone.hidden  = true;
        workspace.hidden = false;
      }).catch(function () {
        alert('Nie udalo sie odczytac archiwum. Sprawdz czy plik nie jest uszkodzony.');
      });
    };
    reader.readAsArrayBuffer(f);
  }

  function renderList(entries) {
    fileList.innerHTML = entries.map(function (e) {
      var isDir = e.entry.dir;
      var icon  = isDir ? 'ti-folder' : 'ti-file';
      var size  = e.entry._data ? fmtSize(e.entry._data.uncompressedSize || 0) : '';
      return '<div class="file-row' + (isDir ? ' is-dir' : '') + '">' +
        '<span class="ti ' + icon + '"></span>' +
        '<span class="file-row-name" title="' + esc(e.path) + '">' + esc(e.path) + '</span>' +
        (size ? '<span class="file-row-size">' + size + '</span>' : '') +
        (!isDir ? '<button class="file-row-dl" data-path="' + esc(e.path) + '">' +
          '<span class="ti ti-download"></span> Pobierz' +
        '</button>' : '') +
      '</div>';
    }).join('');

    fileList.querySelectorAll('[data-path]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var path = btn.dataset.path;
        zipData.file(path).async('blob').then(function (blob) {
          var name = path.split('/').pop();
          var url  = URL.createObjectURL(blob);
          var a    = document.createElement('a');
          a.href = url; a.download = name; a.click();
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        });
      });
    });
  }

  /* btnExtractAll usuniete - pobieranie pojedynczych plikow wystarczy */

  btnNewFile.addEventListener('click', function () {
    zipData = null;
    dropzone.hidden     = false;
    workspace.hidden    = true;
    loadProgress.hidden = true;
  });

  function fmtSize(bytes) {
    if (bytes < 1024)    return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
  }
})();
