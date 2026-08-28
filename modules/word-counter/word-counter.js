/**
 * word-counter.js - Licznik slow
 * Zero zaleznosci. Wszystko liczy sie lokalnie w przegladarce.
 */
(function () {
  'use strict';

  var textInput    = document.getElementById('textInput');
  var statWords    = document.getElementById('statWords');
  var statChars    = document.getElementById('statChars');
  var statCharsNo  = document.getElementById('statCharsNo');
  var statLines    = document.getElementById('statLines');
  var statSentences = document.getElementById('statSentences');
  var statRead     = document.getElementById('statRead');
  var btnClear     = document.getElementById('btnClear');
  var btnCopy      = document.getElementById('btnCopy');

  function update() {
    var text = textInput.value;

    var words     = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    var chars     = text.length;
    var charsNo   = text.replace(/\s/g, '').length;
    var lines     = text === '' ? 0 : text.split(/\n/).length;
    var sentences = text.trim() === '' ? 0 : (text.match(/[^.!?]*[.!?]/g) || []).length;
    var readSec   = Math.round((words / 200) * 60);

    statWords.textContent     = fmt(words);
    statChars.textContent     = fmt(chars);
    statCharsNo.textContent   = fmt(charsNo);
    statLines.textContent     = fmt(lines);
    statSentences.textContent = fmt(sentences);
    statRead.textContent      = fmtTime(readSec);
  }

  function fmt(n) {
    return n.toLocaleString('pl-PL');
  }

  function fmtTime(sec) {
    if (sec < 60) return sec + 's';
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + 'm' + (s > 0 ? ' ' + s + 's' : '');
  }

  textInput.addEventListener('input', update);

  btnClear.addEventListener('click', function () {
    textInput.value = '';
    update();
    textInput.focus();
  });

  btnCopy.addEventListener('click', function () {
    if (!textInput.value) return;
    navigator.clipboard.writeText(textInput.value).then(function () {
      var orig = btnCopy.innerHTML;
      btnCopy.innerHTML = '<span class="ti ti-check"></span> Skopiowano';
      setTimeout(function () { btnCopy.innerHTML = orig; }, 2000);
    });
  });

  update();
})();
