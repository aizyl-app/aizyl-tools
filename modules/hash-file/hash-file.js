/**
 * hash-file.js - Hash pliku
 * Web Crypto API. Zero zaleznosci. Wszystko lokalnie w przegladarce.
 */
(function () {
  'use strict';

  var activeAlgo  = 'SHA-256';
  var currentHash = '';
  var fileBytes   = null;

  var dropzone    = document.getElementById('dropzone');
  var picker      = document.getElementById('picker');
  var workspace   = document.getElementById('workspace');
  var fileInfo    = document.getElementById('fileInfo');
  var loadProgress = document.getElementById('loadProgress');
  var lpFill      = document.getElementById('lpFill');
  var lpLabel     = document.getElementById('lpLabel');
  var hashResult  = document.getElementById('hashResult');
  var hashLabel   = document.getElementById('hashLabel');
  var hashValue   = document.getElementById('hashValue');
  var btnCopy     = document.getElementById('btnCopy');
  var btnNewFile  = document.getElementById('btnNewFile');
  var verifyInput = document.getElementById('verifyInput');
  var verifyBadge = document.getElementById('verifyBadge');

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
    var reader = new FileReader();
    reader.onload = function (ev) {
      fileBytes = ev.target.result;
      fileInfo.innerHTML =
        '<span class="ti ti-file"></span> ' +
        '<strong>' + esc(f.name) + '</strong>' +
        ' <span class="fi-size">(' + fmtSize(f.size) + ')</span>';
      dropzone.hidden   = true;
      workspace.hidden  = false;
      verifyInput.value = '';
      verifyBadge.hidden = true;
      computeHash();
    };
    reader.readAsArrayBuffer(f);
  }

  function computeHash() {
    if (!fileBytes) return;
    loadProgress.hidden = false;
    hashResult.hidden   = true;
    lpFill.style.width  = '40%';
    lpLabel.textContent = 'Obliczam ' + activeAlgo + '...';

    crypto.subtle.digest(activeAlgo, fileBytes).then(function (hashBuf) {
      var arr  = Array.from(new Uint8Array(hashBuf));
      currentHash = arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      lpFill.style.width  = '100%';
      hashLabel.textContent = activeAlgo;
      hashValue.textContent = currentHash;
      loadProgress.hidden = true;
      hashResult.hidden   = false;
      updateVerify();
    });
  }

  document.querySelectorAll('[data-algo]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-algo]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeAlgo = btn.dataset.algo;
      if (fileBytes) computeHash();
    });
  });

  function updateVerify() {
    var val = verifyInput.value.trim().toLowerCase();
    if (!val || !currentHash) { verifyBadge.hidden = true; return; }
    verifyBadge.hidden = false;
    if (val === currentHash) {
      verifyBadge.className = 'verify-badge match';
      verifyBadge.textContent = 'Zgodny';
    } else {
      verifyBadge.className = 'verify-badge nomatch';
      verifyBadge.textContent = 'Niezgodny';
    }
  }

  verifyInput.addEventListener('input', updateVerify);

  btnCopy.addEventListener('click', function () {
    if (!currentHash) return;
    navigator.clipboard.writeText(currentHash).then(function () {
      var orig = btnCopy.innerHTML;
      btnCopy.innerHTML = '<span class="ti ti-check"></span> Skopiowano';
      setTimeout(function () { btnCopy.innerHTML = orig; }, 2000);
    });
  });

  btnNewFile.addEventListener('click', function () {
    fileBytes   = null;
    currentHash = '';
    fileBytes   = null;
    dropzone.hidden     = false;
    workspace.hidden    = true;
    hashResult.hidden   = true;
    loadProgress.hidden = true;
    verifyBadge.hidden  = true;
    verifyInput.value   = '';
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
