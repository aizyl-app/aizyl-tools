/**
 * qr-code.js - Generator kodu QR
 * qrcodejs@1.0.0 z CDN. Wszystko lokalnie w przegladarce.
 */
(function () {
  'use strict';

  var inputText   = document.getElementById('inputText');
  var btnGenerate = document.getElementById('btnGenerate');
  var btnClear    = document.getElementById('btnClear');
  var btnDownload = document.getElementById('btnDownload');
  var resultCard  = document.getElementById('resultCard');
  var qrCanvas    = document.getElementById('qrCanvas');
  var activeSize  = 256;
  var qrInstance  = null;

  document.querySelectorAll('[data-size]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-size]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeSize = parseInt(btn.dataset.size, 10);
    });
  });

  btnGenerate.addEventListener('click', function () {
    var text = inputText.value.trim();
    if (!text) { alert('Wpisz tekst lub link.'); return; }

    qrCanvas.innerHTML = '';

    qrInstance = new QRCode(qrCanvas, {
      text: text,
      width: activeSize,
      height: activeSize,
      colorDark: '#1A1A1A',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });

    resultCard.hidden = false;
  });

  btnDownload.addEventListener('click', function () {
    var canvas = qrCanvas.querySelector('canvas');
    if (!canvas) {
      var img = qrCanvas.querySelector('img');
      if (!img) return;
      var c = document.createElement('canvas');
      c.width  = img.naturalWidth  || activeSize;
      c.height = img.naturalHeight || activeSize;
      c.getContext('2d').drawImage(img, 0, 0);
      canvas = c;
    }
    var a = document.createElement('a');
    a.href     = canvas.toDataURL('image/png');
    a.download = 'qr-code.png';
    a.click();
  });

  btnClear.addEventListener('click', function () {
    inputText.value   = '';
    qrCanvas.innerHTML = '';
    resultCard.hidden = true;
    qrInstance = null;
    inputText.focus();
  });
})();
