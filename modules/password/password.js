/**
 * password.js — Hasło PDF
 * Szyfrowanie i deszyfrowanie PDF przez qpdf skompilowane do WASM.
 * Żadne dane użytkownika nie opuszczają przeglądarki.
 */
(function () {
  'use strict';

  /* ── Konfiguracja qpdf-wasm ───────────────────────────────────────── */
  var WASM_CDN = 'https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/';
  var qpdfPromise = null;

  function ensureQpdf() {
    if (qpdfPromise) return qpdfPromise;
    if (typeof Module === 'undefined') {
      return Promise.reject(new Error('Biblioteka qpdf-wasm niedostępna.'));
    }
    qpdfPromise = Module({
      locateFile: function (filename) { return WASM_CDN + filename; }
    });
    return qpdfPromise;
  }

  /* Zacznij ładować WASM w tle od razu */
  ensureQpdf().catch(function () {});

  /* ── Stan aplikacji ───────────────────────────────────────────────── */
  var fileName   = '';
  var fileBytes  = null;
  var mode       = 'add';
  var errorsList = null;

  /* ── Elementy DOM ─────────────────────────────────────────────────── */
  var dropzone         = document.getElementById('dropzone');
  var picker           = document.getElementById('picker');
  var workspace        = document.getElementById('workspace');
  var fileInfo         = document.getElementById('fileInfo');
  var tabAdd           = document.getElementById('tabAdd');
  var tabRemove        = document.getElementById('tabRemove');
  var panelAdd         = document.getElementById('panelAdd');
  var panelRemove      = document.getElementById('panelRemove');
  var inputPass        = document.getElementById('inputPass');
  var inputPassConfirm = document.getElementById('inputPassConfirm');
  var inputCurrentPass = document.getElementById('inputCurrentPass');
  var btnAction        = document.getElementById('btnAction');
  var btnLabel         = document.getElementById('btnLabel');
  var btnNewFile       = document.getElementById('btnNewFile');
  var actionStatus     = document.getElementById('actionStatus');

  /* ── Dropzone ─────────────────────────────────────────────────────── */
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
    handleFiles(Array.from(e.dataTransfer.files));
  });
  picker.addEventListener('change', function () {
    handleFiles(Array.from(picker.files));
    picker.value = '';
  });

  btnNewFile.addEventListener('click', function () { picker.click(); });
  btnAction.addEventListener('click', function () { runAction(); });
  tabAdd.addEventListener('click',    function () { setMode('add'); });
  tabRemove.addEventListener('click', function () { setMode('remove'); });

  /* ── Obsługa pliku ────────────────────────────────────────────────── */
  function handleFiles(files) {
    var pdf = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].type === 'application/pdf' || files[i].name.toLowerCase().endsWith('.pdf')) {
        pdf = files[i]; break;
      }
    }
    if (!pdf) {
      showError(files[0] ? files[0].name : 'plik', 'Obsługiwane są wyłącznie pliki .pdf.');
      return;
    }
    loadFile(pdf);
  }

  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      fileBytes = new Uint8Array(e.target.result);
      fileName  = file.name;
      showWorkspace(file);
      actionStatus.textContent = '';
      clearFieldErrors();
    };
    reader.onerror = function () {
      showError(file.name, 'Nie udało się odczytać pliku. Sprawdź, czy plik nie jest uszkodzony.');
    };
    reader.readAsArrayBuffer(file);
  }

  function showWorkspace(file) {
    var kb   = Math.round(file.size / 1024);
    var size = kb < 1024 ? kb + ' KB' : (kb / 1024).toFixed(1) + ' MB';
    fileInfo.innerHTML =
      '<span class="ti ti-file-type-pdf" aria-hidden="true"></span>' +
      '<span class="file-info-name">' + escHtml(file.name) + '</span>' +
      '<span class="file-info-size">' + size + '</span>';
    workspace.hidden = false;
  }

  /* ── Przełączanie trybu ───────────────────────────────────────────── */
  function setMode(m) {
    mode = m;
    tabAdd.classList.toggle('active',    m === 'add');
    tabRemove.classList.toggle('active', m === 'remove');
    tabAdd.setAttribute('aria-selected',    m === 'add'    ? 'true' : 'false');
    tabRemove.setAttribute('aria-selected', m === 'remove' ? 'true' : 'false');
    panelAdd.hidden    = (m !== 'add');
    panelRemove.hidden = (m !== 'remove');
    btnLabel.textContent = m === 'add' ? 'Pobierz z hasłem' : 'Pobierz bez hasła';
    actionStatus.textContent = '';
    clearFieldErrors();
  }

  /* ── Akcja główna ─────────────────────────────────────────────────── */
  function runAction() {
    if (!fileBytes) return;
    clearFieldErrors();
    actionStatus.textContent = '';
    if (mode === 'add') {
      runAddPassword();
    } else {
      runRemovePassword();
    }
  }

  /* ── Dodawanie hasła ──────────────────────────────────────────────── */
  function runAddPassword() {
    var pass    = inputPass.value;
    var confirm = inputPassConfirm.value;
    if (!pass) { setFieldError(inputPass, 'Wpisz hasło.'); return; }
    if (pass !== confirm) { setFieldError(inputPassConfirm, 'Hasła nie są identyczne.'); return; }

    setBusy(true);
    actionStatus.textContent = 'Ładuję silnik szyfrowania...';

    ensureQpdf().then(function (qpdf) {
      actionStatus.textContent = 'Szyfrowanie...';
      qpdf.FS.writeFile('/input.pdf', fileBytes);

      var exitCode = qpdf.callMain([
        '/input.pdf',
        '--encrypt', pass, pass, '256',
        '--print=full', '--extract=y',
        '--',
        '/output.pdf'
      ]);

      if (exitCode !== 0) {
        throw new Error('qpdf zakończył z błędem (kod ' + exitCode + ').');
      }

      var output = qpdf.FS.readFile('/output.pdf');
      var baseName = fileName.replace(/\.pdf$/i, '');
      downloadBlob(new Blob([output], { type: 'application/pdf' }), baseName + '-haslo.pdf');
      actionStatus.textContent = 'Pobrano z hasłem.';
    }).catch(function (err) {
      actionStatus.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany błąd');
    }).then(function () {
      cleanupFs();
      setBusy(false);
    });
  }

  /* ── Usuwanie hasła ───────────────────────────────────────────────── */
  function runRemovePassword() {
    setBusy(true);
    actionStatus.textContent = 'Ładuję silnik szyfrowania...';

    ensureQpdf().then(function (qpdf) {
      actionStatus.textContent = 'Odszyfrowuję...';
      qpdf.FS.writeFile('/input.pdf', fileBytes);

      var args = ['--decrypt'];
      if (inputCurrentPass.value) {
        args.push('--password=' + inputCurrentPass.value);
      }
      args.push('/input.pdf', '/output.pdf');

      var exitCode = qpdf.callMain(args);

      if (exitCode !== 0) {
        setFieldError(inputCurrentPass, 'Nieprawidłowe hasło lub plik jest zaszyfrowany.');
        return;
      }

      var output = qpdf.FS.readFile('/output.pdf');
      var baseName = fileName.replace(/\.pdf$/i, '');
      downloadBlob(new Blob([output], { type: 'application/pdf' }), baseName + '-odblokowany.pdf');
      actionStatus.textContent = 'Pobrano bez hasła.';
    }).catch(function (err) {
      actionStatus.textContent = 'Błąd: ' + (err && err.message ? err.message : 'nieznany błąd');
    }).then(function () {
      cleanupFs();
      setBusy(false);
    });
  }

  /* ── Czyszczenie FS ───────────────────────────────────────────────── */
  function cleanupFs() {
    if (!qpdfPromise) return;
    qpdfPromise.then(function (qpdf) {
      try { qpdf.FS.unlink('/input.pdf');  } catch (e) {}
      try { qpdf.FS.unlink('/output.pdf'); } catch (e) {}
    }).catch(function () {});
  }

  /* ── Pomocnicze ───────────────────────────────────────────────────── */
  function setBusy(busy) {
    btnAction.disabled  = busy;
    btnNewFile.disabled = busy;
  }

  function setFieldError(input, msg) {
    input.classList.add('error');
    var err = document.createElement('p');
    err.className   = 'field-error';
    err.textContent = msg;
    input.parentNode.appendChild(err);
  }

  function clearFieldErrors() {
    [inputPass, inputPassConfirm, inputCurrentPass].forEach(function (el) {
      el.classList.remove('error');
    });
    document.querySelectorAll('.field-error').forEach(function (el) { el.remove(); });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function ensureErrorsList() {
    if (!errorsList) {
      errorsList = document.createElement('div');
      errorsList.className = 'errors-list';
      dropzone.parentNode.insertBefore(errorsList, dropzone.nextSibling);
    }
    return errorsList;
  }

  function showError(name, message) {
    var list = ensureErrorsList();
    var item = document.createElement('div');
    item.className = 'file-error';
    item.setAttribute('role', 'alert');
    item.innerHTML =
      '<span class="ti ti-alert-circle" aria-hidden="true"></span>' +
      '<div class="file-error-body">' +
        '<div class="file-error-name">' + escHtml(name)    + '</div>' +
        '<div class="file-error-msg">'  + escHtml(message) + '</div>' +
      '</div>' +
      '<button class="file-error-close" aria-label="Zamknij">' +
        '<span class="ti ti-x" aria-hidden="true"></span>' +
      '</button>';
    item.querySelector('.file-error-close').addEventListener('click', function () { item.remove(); });
    list.appendChild(item);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

})();
