/**
 * case-converter.js - Konwerter wielkosci liter
 * Zero zaleznosci. Wszystko dziala lokalnie w przegladarce.
 */
(function () {
  'use strict';

  var textInput  = document.getElementById('textInput');
  var resultText = document.getElementById('resultText');
  var btnCopy    = document.getElementById('btnCopy');
  var btnClear   = document.getElementById('btnClear');
  var activeCase = 'upper';

  function toWords(text) {
    return text.trim().split(/[\s\-_]+/).filter(Boolean);
  }

  var converters = {
    upper:    function (t) { return t.toUpperCase(); },
    lower:    function (t) { return t.toLowerCase(); },
    title:    function (t) {
      return t.toLowerCase().replace(/(?:^|\s)\S/g, function (c) { return c.toUpperCase(); });
    },
    sentence: function (t) {
      return t.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, function (c) { return c.toUpperCase(); });
    },
    camel:    function (t) {
      var words = toWords(t);
      return words.map(function (w, i) {
        return i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }).join('');
    },
    pascal:   function (t) {
      return toWords(t).map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }).join('');
    },
    snake:    function (t) {
      return toWords(t).join('_').toLowerCase();
    },
    kebab:    function (t) {
      return toWords(t).join('-').toLowerCase();
    }
  };

  function convert() {
    var text = textInput.value;
    if (!text.trim()) { resultText.textContent = ''; return; }
    var fn = converters[activeCase];
    resultText.textContent = fn ? fn(text) : text;
  }

  document.querySelectorAll('[data-case]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-case]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeCase = btn.dataset.case;
      convert();
    });
  });

  textInput.addEventListener('input', convert);

  btnCopy.addEventListener('click', function () {
    var text = resultText.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () {
      var orig = btnCopy.innerHTML;
      btnCopy.innerHTML = '<span class="ti ti-check"></span> Skopiowano';
      setTimeout(function () { btnCopy.innerHTML = orig; }, 2000);
    });
  });

  btnClear.addEventListener('click', function () {
    textInput.value = '';
    resultText.textContent = '';
    textInput.focus();
  });

  convert();
})();
