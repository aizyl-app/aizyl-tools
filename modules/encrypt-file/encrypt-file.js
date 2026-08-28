/**
 * encrypt-file.js - Szyfrowanie pliku
 * Web Crypto API, AES-GCM 256-bit, PBKDF2. Zero zaleznosci. Wszystko lokalnie.
 */
(function () {
  'use strict';

  var mode       = 'encrypt';
  var fileBytes  = null;
  var fileName   = '';
  var fileSize   = 0;

  var tabEncrypt   = document.getElementById('tabEncrypt');
  var tabDecrypt   = document.getElementById('tabDecrypt');
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var fileInfo     = document.getElementById('fileInfo');
  var inputPass    = document.getElementById('inputPassword');
  var btnToggle    = document.getElementById('btnTogglePass');
  var btnAction    = document.getElementById('btnAction');
  var btnNewFile   = document.getElementById('btnNewFile');
  var errorMsg     = document.getElementById('errorMsg');
  var loadProgress = document.getElementById('loadProgress');
  var lpFill       = document.getElementById('lpFill');
  var lpLabel      = document.getElementById('lpLabel');
  var dzIcon       = dropzone.querySelector('.dz-icon');

  tabEncrypt.addEventListener('click', function () {
    mode = 'encrypt';
    tabEncrypt.classList.add('active');
    tabDecrypt.classList.remove('active');
    btnAction.innerHTML = '<span class="ti ti-lock"></span> Szyfruj i pobierz';
    dzIcon.className = 'ti ti-lock dz-icon';
    reset();
  });

  tabDecrypt.addEventListener('click', function () {
    mode = 'decrypt';
    tabDecrypt.classList.add('active');
    tabEncrypt.classList.remove('active');
    btnAction.innerHTML = '<span class="ti ti-lock-open"></span> Odszyfruj i pobierz';
    dzIcon.className = 'ti ti-lock-open dz-icon';
    reset();
  });

  function reset() {
    fileBytes = null; fileName = ''; fileSize = 0;
    dropzone.hidden  = false;
    workspace.hidden = true;
    errorMsg.hidden  = true;
    loadProgress.hidden = true;
    inputPass.value  = '';
  }

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
    fileName = f.name; fileSize = f.size;
    var reader = new FileReader();
    reader.onload = function (ev) {
      fileBytes = ev.target.result;
      fileInfo.innerHTML =
        '<span class="ti ti-file"></span> ' +
        '<strong>' + esc(f.name) + '</strong>' +
        ' <span class="fi-size">(' + fmtSize(f.size) + ')</span>';
      dropzone.hidden  = true;
      workspace.hidden = false;
      errorMsg.hidden  = true;
    };
    reader.readAsArrayBuffer(f);
  }

  btnToggle.addEventListener('click', function () {
    var isPass = inputPass.type === 'password';
    inputPass.type = isPass ? 'text' : 'password';
    btnToggle.querySelector('.ti').className = 'ti ' + (isPass ? 'ti-eye-off' : 'ti-eye');
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
    loadProgress.hidden = true;
  }

  function getKey(password, salt, usage) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, [usage]
        );
      });
  }

  btnAction.addEventListener('click', function () {
    var pass = inputPass.value;
    if (!fileBytes) { showError('Wybierz plik.'); return; }
    if (!pass)      { showError('Wpisz haslo.'); return; }
    errorMsg.hidden     = true;
    loadProgress.hidden = false;
    lpFill.style.width  = '20%';

    if (mode === 'encrypt') {
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var iv   = crypto.getRandomValues(new Uint8Array(12));
      lpLabel.textContent = 'Szyfruję...';
      getKey(pass, salt, 'encrypt').then(function (key) {
        lpFill.style.width = '50%';
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, fileBytes)
          .then(function (cipherBuf) {
            var cipher   = new Uint8Array(cipherBuf);
            var combined = new Uint8Array(16 + 12 + cipher.length);
            combined.set(salt, 0);
            combined.set(iv, 16);
            combined.set(cipher, 28);
            lpFill.style.width = '100%';
            loadProgress.hidden = true;
            downloadBytes(combined, fileName + '.enc', 'application/octet-stream');
          });
      }).catch(function () { showError('Blad szyfrowania.'); });

    } else {
      lpLabel.textContent = 'Odszyfrowuję...';
      var data = new Uint8Array(fileBytes);
      if (data.length < 29) { showError('Nieprawidlowy plik .enc.'); return; }
      var salt   = data.slice(0, 16);
      var iv     = data.slice(16, 28);
      var cipher = data.slice(28);
      getKey(pass, salt, 'decrypt').then(function (key) {
        lpFill.style.width = '50%';
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher)
          .then(function (plainBuf) {
            lpFill.style.width = '100%';
            loadProgress.hidden = true;
            var outName = fileName.replace(/\.enc$/, '') || fileName + '_decrypted';
            downloadBytes(new Uint8Array(plainBuf), outName, 'application/octet-stream');
          });
      }).catch(function () { showError('Nieprawidlowe haslo lub uszkodzony plik.'); });
    }
  });

  btnNewFile.addEventListener('click', reset);

  function downloadBytes(bytes, name, type) {
    var blob = new Blob([bytes], { type: type });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
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
