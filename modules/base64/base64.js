/**
 * base64.js - Koder i dekoder Base64
 * Zero zaleznosci. Wbudowane API przegladarki. Wszystko lokalnie.
 */
(function () {
  'use strict';

  var tabText     = document.getElementById('tabText');
  var tabFile     = document.getElementById('tabFile');
  var panelText   = document.getElementById('panelText');
  var panelFile   = document.getElementById('panelFile');
  var inputText   = document.getElementById('inputText');
  var outputText  = document.getElementById('outputText');
  var errorText   = document.getElementById('errorText');
  var btnEncode   = document.getElementById('btnEncode');
  var btnDecode   = document.getElementById('btnDecode');
  var btnClearText = document.getElementById('btnClearText');
  var btnCopyText = document.getElementById('btnCopyText');
  var btnSwap     = document.getElementById('btnSwap');
  var dropzone    = document.getElementById('dropzone');
  var picker      = document.getElementById('picker');
  var fileResult  = document.getElementById('fileResult');
  var fileInfo    = document.getElementById('fileInfo');
  var outputFile  = document.getElementById('outputFile');
  var btnCopyFile = document.getElementById('btnCopyFile');
  var btnDownloadFile = document.getElementById('btnDownloadFile');
  var btnNewFile  = document.getElementById('btnNewFile');

  /* —— Taby ——————————————————————————————————————————————————————— */
  tabText.addEventListener('click', function () {
    tabText.classList.add('active');
    tabFile.classList.remove('active');
    panelText.hidden = false;
    panelFile.hidden = true;
  });
  tabFile.addEventListener('click', function () {
    tabFile.classList.add('active');
    tabText.classList.remove('active');
    panelFile.hidden = false;
    panelText.hidden = true;
  });

  /* —— Panel tekstowy ————————————————————————————————————————————— */
  function showError(msg) {
    errorText.textContent = msg;
    errorText.hidden = false;
  }
  function clearError() { errorText.hidden = true; }

  btnEncode.addEventListener('click', function () {
    clearError();
    var text = inputText.value;
    if (!text) return;
    try {
      outputText.value = btoa(unescape(encodeURIComponent(text)));
    } catch (e) {
      showError('Blad kodowania: ' + e.message);
    }
  });

  btnDecode.addEventListener('click', function () {
    clearError();
    var text = inputText.value.trim();
    if (!text) return;
    try {
      outputText.value = decodeURIComponent(escape(atob(text)));
    } catch (e) {
      showError('Nieprawidlowy ciag Base64. Sprawdz dane wejsciowe.');
    }
  });

  btnClearText.addEventListener('click', function () {
    inputText.value  = '';
    outputText.value = '';
    clearError();
    inputText.focus();
  });

  btnCopyText.addEventListener('click', function () {
    if (!outputText.value) return;
    navigator.clipboard.writeText(outputText.value).then(function () {
      var orig = btnCopyText.innerHTML;
      btnCopyText.innerHTML = '<span class="ti ti-check"></span> Skopiowano';
      setTimeout(function () { btnCopyText.innerHTML = orig; }, 2000);
    });
  });

  btnSwap.addEventListener('click', function () {
    var tmp = inputText.value;
    inputText.value  = outputText.value;
    outputText.value = tmp;
    clearError();
  });

  /* —— Panel plikowy ————————————————————————————————————————————— */
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
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  picker.addEventListener('change', function () {
    if (picker.files[0]) handleFile(picker.files[0]);
    picker.value = '';
  });

  function handleFile(f) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      var b64 = ev.target.result.split(',')[1];
      outputFile.value = b64;
      fileInfo.innerHTML =
        '<span class="ti ti-file"></span> ' +
        '<strong>' + esc(f.name) + '</strong>' +
        ' <span class="fi-size">(' + fmtSize(f.size) + ' / Base64: ' + fmtSize(b64.length) + ')</span>';
      dropzone.hidden  = true;
      fileResult.hidden = false;

      btnDownloadFile.onclick = function () {
        var blob = new Blob([b64], { type: 'text/plain' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = f.name + '.b64.txt';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      };
    };
    reader.readAsDataURL(f);
  }

  btnCopyFile.addEventListener('click', function () {
    if (!outputFile.value) return;
    navigator.clipboard.writeText(outputFile.value).then(function () {
      var orig = btnCopyFile.innerHTML;
      btnCopyFile.innerHTML = '<span class="ti ti-check"></span> Skopiowano';
      setTimeout(function () { btnCopyFile.innerHTML = orig; }, 2000);
    });
  });

  btnNewFile.addEventListener('click', function () {
    outputFile.value  = '';
    dropzone.hidden   = false;
    fileResult.hidden = true;
  });

  /* —— Helpers ————————————————————————————————————————————————————— */
  function fmtSize(bytes) {
    if (bytes < 1024)    return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
  }
})();
