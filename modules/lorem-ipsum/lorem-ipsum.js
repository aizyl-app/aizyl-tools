/**
 * lorem-ipsum.js - Generator Lorem Ipsum
 * Zero zaleznosci. Wszystko dziala lokalnie w przegladarce.
 */
(function () {
  'use strict';

  var WORDS = [
    'lorem','ipsum','dolor','sit','amet','consectetur','adipiscing','elit',
    'sed','do','eiusmod','tempor','incididunt','ut','labore','et','dolore',
    'magna','aliqua','enim','ad','minim','veniam','quis','nostrud','exercitation',
    'ullamco','laboris','nisi','aliquip','ex','ea','commodo','consequat','duis',
    'aute','irure','in','reprehenderit','voluptate','velit','esse','cillum',
    'fugiat','nulla','pariatur','excepteur','sint','occaecat','cupidatat','non',
    'proident','sunt','culpa','qui','officia','deserunt','mollit','anim','id','est',
    'laborum','perspiciatis','unde','omnis','iste','natus','error','accusantium',
    'doloremque','laudantium','totam','rem','aperiam','eaque','ipsa','quae','ab',
    'illo','inventore','veritatis','quasi','architecto','beatae','vitae','dicta',
    'explicabo','nemo','ipsam','quia','voluptas','aspernatur','aut','odit','fugit',
    'consequuntur','magni','dolores','eos','ratione','sequi','nesciunt','neque',
    'porro','quisquam','dolorem','adipisci','numquam','eius','modi','tempora',
    'incidunt','magnam','quaerat','voluptatem'
  ];

  var SENTENCES_PER_PARAGRAPH = [4, 5, 6, 7];
  var WORDS_PER_SENTENCE = [8, 10, 12, 15, 18];

  function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function genSentence() {
    var count = rand(WORDS_PER_SENTENCE);
    var words = [];
    for (var i = 0; i < count; i++) {
      words.push(rand(WORDS));
    }
    return capitalize(words.join(' ')) + '.';
  }

  function genParagraph() {
    var count = rand(SENTENCES_PER_PARAGRAPH);
    var sentences = [];
    for (var i = 0; i < count; i++) {
      sentences.push(genSentence());
    }
    return sentences.join(' ');
  }

  function generate(mode, amount) {
    var result = [];
    if (mode === 'paragraphs') {
      for (var i = 0; i < amount; i++) {
        result.push(genParagraph());
      }
      return result.join('\n\n');
    }
    if (mode === 'sentences') {
      for (var i = 0; i < amount; i++) {
        result.push(genSentence());
      }
      return result.join(' ');
    }
    if (mode === 'words') {
      for (var i = 0; i < amount; i++) {
        result.push(rand(WORDS));
      }
      return result.join(' ');
    }
    return '';
  }

  var activeMode   = 'paragraphs';
  var amountInput  = document.getElementById('amountInput');
  var resultText   = document.getElementById('resultText');
  var btnGenerate  = document.getElementById('btnGenerate');
  var btnCopy      = document.getElementById('btnCopy');
  var btnMinus     = document.getElementById('btnMinus');
  var btnPlus      = document.getElementById('btnPlus');

  document.querySelectorAll('[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeMode = btn.dataset.mode;
    });
  });

  btnMinus.addEventListener('click', function () {
    var v = parseInt(amountInput.value, 10) || 1;
    if (v > 1) amountInput.value = v - 1;
  });

  btnPlus.addEventListener('click', function () {
    var v = parseInt(amountInput.value, 10) || 1;
    if (v < 100) amountInput.value = v + 1;
  });

  btnGenerate.addEventListener('click', function () {
    var amount = Math.max(1, Math.min(100, parseInt(amountInput.value, 10) || 3));
    resultText.textContent = generate(activeMode, amount);
  });

  btnCopy.addEventListener('click', function () {
    var text = resultText.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () {
      var orig = btnCopy.innerHTML;
      btnCopy.innerHTML = '<span class="ti ti-check"></span> Skopiowano';
      setTimeout(function () { btnCopy.innerHTML = orig; }, 2000);
    });
  });

  btnGenerate.click();
})();
