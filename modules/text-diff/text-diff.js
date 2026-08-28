/**
 * text-diff.js - Porownanie tekstu
 * Wlasny algorytm LCS diff. Zero zaleznosci. Wszystko lokalnie.
 */
(function () {
  'use strict';

  var inputA       = document.getElementById('inputA');
  var inputB       = document.getElementById('inputB');
  var btnCompare   = document.getElementById('btnCompare');
  var btnClear     = document.getElementById('btnClear');
  var resultSection = document.getElementById('resultSection');
  var diffStats    = document.getElementById('diffStats');
  var diffOutput   = document.getElementById('diffOutput');

  /* LCS diff na slowach */
  function tokenize(text) {
    return text.match(/\S+|\s+/g) || [];
  }

  function lcs(a, b) {
    var m = a.length, n = b.length;
    var dp = [];
    var i, j;
    for (i = 0; i <= m; i++) {
      dp[i] = new Array(n + 1).fill(0);
    }
    for (i = 1; i <= m; i++) {
      for (j = 1; j <= n; j++) {
        if (a[i-1] === b[j-1]) {
          dp[i][j] = dp[i-1][j-1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
        }
      }
    }
    var result = [];
    i = m; j = n;
    while (i > 0 && j > 0) {
      if (a[i-1] === b[j-1]) {
        result.unshift({ type: 'eq', val: a[i-1] });
        i--; j--;
      } else if (dp[i-1][j] >= dp[i][j-1]) {
        result.unshift({ type: 'del', val: a[i-1] });
        i--;
      } else {
        result.unshift({ type: 'add', val: b[j-1] });
        j--;
      }
    }
    while (i > 0) { result.unshift({ type: 'del', val: a[i-1] }); i--; }
    while (j > 0) { result.unshift({ type: 'add', val: b[j-1] }); j--; }
    return result;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');
  }

  function render(diff) {
    var added = 0, deleted = 0;
    var html = diff.map(function (d) {
      if (d.type === 'add') { added++;   return '<span class="diff-add">' + esc(d.val) + '</span>'; }
      if (d.type === 'del') { deleted++; return '<span class="diff-del">' + esc(d.val) + '</span>'; }
      return esc(d.val);
    }).join('');

    diffOutput.innerHTML = html;
    diffStats.innerHTML =
      'Dodane: <strong>' + added + '</strong> tokenow, ' +
      'usuniete: <strong>' + deleted + '</strong> tokenow.';
    resultSection.hidden = false;
  }

  btnCompare.addEventListener('click', function () {
    var a = inputA.value;
    var b = inputB.value;
    if (!a && !b) return;
    var tokA = tokenize(a);
    var tokB = tokenize(b);
    var diff = lcs(tokA, tokB);
    render(diff);
  });

  btnClear.addEventListener('click', function () {
    inputA.value = '';
    inputB.value = '';
    resultSection.hidden = true;
    inputA.focus();
  });
})();
