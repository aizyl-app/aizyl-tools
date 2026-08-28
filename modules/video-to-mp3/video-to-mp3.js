/**
 * video-to-mp3.js — Wideo na MP3
 * Konwertuje plik wideo do MP3 lokalnie przez FFmpeg.wasm (FFmpegWASM UMD global).
 * Żadne dane użytkownika nie opuszczają przeglądarki.
 */
(function () {
  'use strict';

  /* —— Ścieżki FFmpeg (pliki lokalne) ——————————————————————————————— */
  var FFMPEG_CORE = '/shared/ffmpeg/core/ffmpeg-core.js';
  var FFMPEG_WASM = '/shared/ffmpeg/core/ffmpeg-core.wasm';

  /* —— Stan aplikacji ——————————————————————————————————————————————— */
  var fileName      = '';
  var fileSize      = 0;
  var fileBytes     = null;
  var activeBitrate = '192';
  var resultBytes   = null;
  var ff            = null;

  /* —— Elementy DOM ————————————————————————————————————————————————— */
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var fileInfo     = document.getElementById('fileInfo');
  var btnConvert   = document.getElementById('btnConvert');
  var btnNewFile   = document.getElementById('btnNewFile');
  var loadProgress = document.getElementById('loadProgress');
  var lpFill       = document.getElementById('lpFill');
  var lpLabel      = document.getElementById('lpLabel');
  var resultCard   = document.getElementById('resultCard');
  var sizeBefore   = document.getElementById('sizeBefore');
  var sizeAfter    = document.getElementById('sizeAfter');
  var btnDownload  = document.getElementById('btnDownload');

  /* —— Dropzone ————————————————————————————————————————————————————— */
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

  /* —— Obsługa pliku ———————————————————————————————————————————————— */
  function handleFiles(files) {
    var f = files[0];
    if (!f) return;
    var isVideo = f.type.startsWith('video/') ||
      /\.(mp4|mkv|avi|mov|webm|m4v|flv|wmv)$/i.test(f.name);
    if (!isVideo) {
      alert('Wybierz plik wideo (MP4, MKV, AVI, MOV, WebM).');
      return;
    }
    fileName  = f.name;
    fileSize  = f.size;
    resultBytes = null;
    var reader = new FileReader();
    reader.onload = function (ev) {
      fileBytes = new Uint8Array(ev.target.result);
      showWorkspace();
    };
    reader.readAsArrayBuffer(f);
  }

  function showWorkspace() {
    dropzone.hidden  = true;
    workspace.hidden = false;
    resultCard.hidden   = true;
    loadProgress.hidden = true;
    btnConvert.disabled = false;
    fileInfo.innerHTML =
      '<span class="ti ti-file-type-mp4"></span> ' +
      '<strong>' + esc(fileName) + '</strong>' +
      ' <span class="fi-size">(' + fmtSize(fileSize) + ')</span>';
  }

  /* —— Przyciski jakości ——————————————————————————————————————————— */
  document.querySelectorAll('[data-bitrate]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-bitrate]').forEach(function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      activeBitrate = btn.dataset.bitrate;
    });
  });

  /* —— Inicjalizacja FFmpeg (leniwa) ——————————————————————————————— */
  function initFFmpeg() {
    if (ff && ff.loaded) return Promise.resolve();
    var FFmpegClass = FFmpegWASM.FFmpeg;
    ff = new FFmpegClass();
    ff.on('progress', function (p) {
      var pct = Math.min(100, Math.round((p.progress || 0) * 100));
      lpFill.style.width = pct + '%';
      if (pct > 0) lpLabel.textContent = 'Konwertuję... ' + pct + '%';
    });
    lpFill.style.width = '0%';
    lpLabel.textContent = 'Ładuję silnik konwersji...';
    return ff.load({ coreURL: FFMPEG_CORE, wasmURL: FFMPEG_WASM });
  }

  /* —— Konwersja ——————————————————————————————————————————————————— */
  btnConvert.addEventListener('click', function () {
    if (!fileBytes) return;
    btnConvert.disabled = true;
    loadProgress.hidden = false;
    resultCard.hidden   = true;
    lpFill.style.width  = '0%';
    lpLabel.textContent = 'Przygotowuję...';

    var ext        = (fileName.split('.').pop() || 'mp4').toLowerCase();
    var inputName  = 'input.' + ext;
    var outputName = 'output.mp3';

    initFFmpeg()
      .then(function () {
        lpLabel.textContent = 'Wczytuję plik...';
        return ff.writeFile(inputName, fileBytes);
      })
      .then(function () {
        lpLabel.textContent = 'Konwertuję...';
        return ff.exec([
          '-i', inputName,
          '-b:a', activeBitrate + 'k',
          '-map', 'a',
          outputName
        ]);
      })
      .then(function () {
        return ff.readFile(outputName);
      })
      .then(function (data) {
        resultBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        return Promise.all([
          ff.deleteFile(inputName),
          ff.deleteFile(outputName)
        ]);
      })
      .then(function () {
        var baseName = fileName.replace(/\.[^.]+$/, '');
        sizeBefore.textContent = fmtSize(fileSize);
        sizeAfter.textContent  = fmtSize(resultBytes.length);
        btnDownload.onclick = function () {
          downloadBytes(resultBytes, baseName + '.mp3', 'audio/mpeg');
        };
        loadProgress.hidden = true;
        resultCard.hidden   = false;
        btnConvert.disabled = false;
      })
      .catch(function (err) {
        loadProgress.hidden = true;
        btnConvert.disabled = false;
        var msg = (err && err.message) ? err.message : String(err);
        alert('Błąd konwersji: ' + msg);
      });
  });

  /* —— Nowy plik ——————————————————————————————————————————————————— */
  btnNewFile.addEventListener('click', function () {
    fileBytes   = null;
    resultBytes = null;
    dropzone.hidden     = false;
    workspace.hidden    = true;
    resultCard.hidden   = true;
    loadProgress.hidden = true;
    btnConvert.disabled = false;
  });

  /* —— Helpers ————————————————————————————————————————————————————— */
  function fmtSize(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');
  }

  function downloadBytes(bytes, name, type) {
    var blob = new Blob([bytes], { type: type });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }
})();
