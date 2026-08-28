/**
 * encrypt-text.js - Szyfrowanie tekstu
 * Web Crypto API, AES-GCM 256-bit, PBKDF2. Zero zaleznosci. Wszystko lokalnie.
 */
(function () {
  'use strict';

  var mode        = 'encrypt';
  var tabEncrypt  = document.getElementById('tabEncrypt');
  var tabDecrypt  = document.getElementById('tabDecrypt');
  var inputText   = document.getElementById('inputText');
  var inputPass   = document.getElementById('inputPassword');
  var btnToggle   = document.getElementById('btnTogglePass');
  var btnAction   = document.getElementById('btnAction');
  var btnClear    = document.getElementById('btnClear');
  var btnCopy     = document.getElementById('btnCopy');
  var errorMsg    = document.getElementById('errorMsg');
  var resultSection = document.getElementById('resultSection');
  var outputText  = document.getElementById('outputText');

  tabEncrypt.addEventListener('click', function () {
    mode = 'encrypt';
    tabEncrypt.classList.add('active');
    tabDecrypt.classList.remove('active');
    btnAction.innerHTML = '<span class="ti ti-lock"></span> Szyfruj';
    inputText.placeholder = 'Wklej tekst do zaszyfrowania...';
    reset();
  });

  tabDecrypt.addEventListener('click', function () {
    mode = 'decrypt';
    tabDecrypt.classList.add('active');
    tabEncrypt.classList.remove('active');
    btnAction.innerHTML = '<span class="ti ti-lock-open"></span> Odszyfruj';
    inputText.placeholder = 'Wklej zaszyfrowany tekst (Base64)...';
    reset();
  });

  btnToggle.addEventListener('click', function () {
    var isPass = inputPass.type === 'password';
    inputPass.type = isPass ? 'text' : 'password';
    btnToggle.querySelector('.ti').className = 'ti ' + (isPass ? 'ti-eye-off' : 'ti-eye');
  });

  function reset() {
    errorMsg.hidden    = true;
    resultSection.hidden = true;
    outputText.value   = '';
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
    resultSection.hidden = true;
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesToB64(bytes) {
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function getKey(password, salt, usage) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    ).then(function (baseKey) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        [usage]
      );
    });
  }

  btnAction.addEventListener('click', function () {
    var text = inputText.value.trim();
    var pass = inputPass.value;
    reset();

    if (!text) { showError('Wpisz tekst.'); return; }
    if (!pass)  { showError('Wpisz haslo.'); return; }

    if (mode === 'encrypt') {
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var iv   = crypto.getRandomValues(new Uint8Array(12));
      getKey(pass, salt, 'encrypt').then(function (key) {
        var enc = new TextEncoder();
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(text))
          .then(function (cipherBuf) {
            var cipher = new Uint8Array(cipherBuf);
            var combined = new Uint8Array(salt.length + iv.length + cipher.length);
            combined.set(salt, 0);
            combined.set(iv, salt.length);
            combined.set(cipher, salt.length + iv.length);
            outputText.value = bytesToB64(combined);
            resultSection.hidden = false;
          });
      }).catch(function () { showError('Blad szyfrowania.'); });

    } else {
      try {
        var combined = b64ToBytes(text);
        var salt = combined.slice(0, 16);
        var iv   = combined.slice(16, 28);
        var cipher = combined.slice(28);
        getKey(pass, salt, 'decrypt').then(function (key) {
          return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher)
            .then(function (plainBuf) {
              var dec = new TextDecoder();
              outputText.value = dec.decode(plainBuf);
              resultSection.hidden = false;
            });
        }).catch(function () { showError('Nieprawidlowe haslo lub uszkodzony tekst.'); });
      } catch (e) {
        showError('Nieprawidlowy format zaszyfrowanego tekstu.');
      }
    }
  });

  btnClear.addEventListener('click', function () {
    inputText.value  = '';
    inputPass.value  = '';
    reset();
    inputText.focus();
  });

  btnCopy.addEventListener('click', function () {
    if (!outputText.value) return;
    navigator.clipboard.writeText(outputText.value).then(function () {
      var orig = btnCopy.innerHTML;
      btnCopy.innerHTML = '<span class="ti ti-check"></span> Skopiowano';
      setTimeout(function () { btnCopy.innerHTML = orig; }, 2000);
    });
  });
})();
