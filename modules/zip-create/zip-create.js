/**
 * zip-create.js - Tworzenie archiwum ZIP
 * JSZip@3.10.1 z CDN. Wszystko lokalnie w przegladarce.
 */
(function () {
  'use strict';

  var files        = [];
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var fileList     = document.getElementById('fileList');
  var fileListFooter = document.getElementById('fileListFooter');
  var btnAddMore   = document.getElementById('btnAddMore');
  var zipName      = document.getElementById('zipName');
  var btnCreate    = document.getElementById('btnCreate');
  var btnClear     = document.getElementById('btnClear');
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
    addFiles(Array.from(e.dataTransfer.files));
  });
  picker.addEventListener('change', function () {
    addFiles(Array.from(picker.files));
    picker.value = '';
  });
  btnAddMore.addEventListener('click', function () { picker.click(); });

  function addFiles(newFiles) {
    newFiles.forEach(function (f) {
      var exists = files.some(function (x) { return x.name === f.name && x.size === f.size; });
      if (!exists) files.push(f);
    });
    renderList();
    if (files.length > 0) {
      dropzone.hidden  = true;
      workspace.hidden = false;
    }
  }

  function renderList() {
    fileList.innerHTML = files.map(function (f, i) {
      return '<div class="file-row">' +
        '<span class="ti ti-file"></span>' +
        '<span class="file-row-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
        '<span class="file-row-size">' + fmtSize(f.size) + '</span>' +
        '<button class="file-row-del" data-idx="' + i + '" title="Usun" aria-label="Usun plik">' +
          '<span class="ti ti-x"></span>' +
        '</button>' +
      '</div>';
    }).join('');

    var total = files.reduce(function (s, f) { return s + f.size; }, 0);
    fileListFooter.textContent = files.length + ' ' + pluralFiles(files.length) + ', lacznie ' + fmtSize(total);

    fileList.querySelectorAll('[data-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        files.splice(parseInt(btn.dataset.idx, 10), 1);
        if (files.length === 0) {
          dropzone.hidden  = false;
          workspace.hidden = true;
        } else {
          renderList();
        }
      });
    });
  }

  btnCreate.addEventListener('click', function () {
    if (files.length === 0) return;
    loadProgress.hidden = false;
    btnCreate.disabled  = true;
    lpFill.style.width  = '0%';
    lpLabel.textContent = 'Pakuje pliki...';

    var zip  = new JSZip();
    var done = 0;

    function readNext(i) {
      if (i >= files.length) {
        lpLabel.textContent = 'Generuje archiwum...';
        lpFill.style.width  = '80%';
        var name = zipName.value.trim() || 'archiwum.zip';
        if (!name.endsWith('.zip')) name += '.zip';
        zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
          function (meta) {
            lpFill.style.width = Math.round(80 + meta.percent * 0.2) + '%';
          }
        ).then(function (blob) {
          lpFill.style.width  = '100%';
          loadProgress.hidden = true;
          btnCreate.disabled  = false;
          var url = URL.createObjectURL(blob);
          var a   = document.createElement('a');
          a.href = url; a.download = name; a.click();
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        });
        return;
      }
      var f = files[i];
      var reader = new FileReader();
      reader.onload = function (ev) {
        zip.file(f.name, ev.target.result);
        done++;
        lpFill.style.width = Math.round((done / files.length) * 70) + '%';
        lpLabel.textContent = 'Wczytuję ' + done + ' z ' + files.length + '...';
        readNext(i + 1);
      };
      reader.readAsArrayBuffer(f);
    }
    readNext(0);
  });

  btnClear.addEventListener('click', function () {
    files = [];
    dropzone.hidden  = false;
    workspace.hidden = true;
    loadProgress.hidden = true;
    btnCreate.disabled  = false;
  });

  function pluralFiles(n) {
    if (n === 1) return 'plik';
    if (n >= 2 && n <= 4) return 'pliki';
    return 'plikow';
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
