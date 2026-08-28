/**
 * compress-audio.js - Kompresja audio
 * FFmpeg.wasm (FFmpegWASM UMD global). Zero danych wychodzi z przegladarki.
 */
(function () {
  'use strict';

  var FFMPEG_CORE = '/shared/ffmpeg/core/ffmpeg-core.js';
  var FFMPEG_WASM = '/shared/ffmpeg/core/ffmpeg-core.wasm';

  var fileName      = '';
  var fileSize      = 0;
  var fileBytes     = null;
  var activeBitrate = '128';
  var resultBytes   = null;
  var ff            = null;

  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var fileInfo     = document.getElementById('fileInfo');
  var btnCompress  = document.getElementById('btnCompress');
  var btnNewFile   = document.getElementById('btnNewFile');
  var loadProgress = document.getElementById('loadProgress');
  var lpFill       = document.getElementById('lpFill');
  var lpLabel      = document.getElementById('lpLabel');
  var resultCard   = document.getElementById('resultCard');
  var sizeBefore   = document.getElementById('sizeBefore');
  var sizeAfter    = document.getElementById('sizeAfter');
  var resultBadge  = document.getElementById('resultBadge');
  var btnDownload  = document.getElementById('btnDownload');

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

  function handleFiles(files) {
    var f = files[0];
    if (!f) return;
    var isAudio = f.type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|m4a|flac|aac|opus|weba)$/i.test(f.name);
    if (!isAudio) {
      alert('Wybierz plik audio (MP3, WAV, OGG, M4A, FLAC).');
      return;
    }
    fileName    = f.name;
    fileSize    = f.size;
    resultBytes = null;
    var reader  = new FileReader();
    reader.onload = function (ev) {
      fileBytes = new Uint8Array(ev.target.result);
      showWorkspace();
    };
    reader.readAsArrayBuffer(f);
  }

  function showWorkspace() {
    dropzone.hidden     = true;
    workspace.hidden    = false;
    resultCard.hidden   = true;
    loadProgress.hidden = true;
    btnCompress.disabled = false;
    fileInfo.innerHTML =
      '<span class="ti ti-file-music"></span> ' +
      '<strong>' + esc(fileName) + '</strong>' +
      ' <span class="fi-size">(' + fmtSize(fileSize) + ')</span>';
  }

  document.querySelectorAll('[data-bitrate]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-bitrate]').forEach(function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      activeBitrate = btn.dataset.bitrate;
    });
  });

  function initFFmpeg() {
    if (ff && ff.loaded) return Promise.resolve();
    var FFmpegClass = FFmpegWASM.FFmpeg;
    ff = new FFmpegClass();
    ff.on('progress', function (p) {
      var pct = Math.min(95, Math.round((p.progress || 0) * 100));
      lpFill.style.width = pct + '%';
      if (pct > 0) lpLabel.textContent = 'Kompresuję... ' + pct + '%';
    });
    lpFill.style.width  = '0%';
    lpLabel.textContent = 'Ładuję silnik konwersji...';
    return ff.load({ coreURL: FFMPEG_CORE, wasmURL: FFMPEG_WASM });
  }

  btnCompress.addEventListener('click', function () {
    if (!fileBytes) return;

    btnCompress.disabled = true;
    loadProgress.hidden  = false;
    resultCard.hidden    = true;
    lpFill.style.width   = '0%';
    lpLabel.textContent  = 'Przygotowuję...';

    var ext        = (fileName.split('.').pop() || 'mp3').toLowerCase();
    var inputName  = 'input.' + ext;
    var outputName = 'output.mp3';

    initFFmpeg()
      .then(function () {
        lpLabel.textContent = 'Wczytuję plik...';
        return ff.writeFile(inputName, fileBytes);
      })
      .then(function () {
        lpLabel.textContent = 'Kompresuję...';
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
        var saved    = Math.round((1 - resultBytes.length / fileSize) * 100);
        sizeBefore.textContent = fmtSize(fileSize);
        sizeAfter.textContent  = fmtSize(resultBytes.length);
        resultBadge.textContent = saved > 0 ? '-' + saved + '%' : '~' + saved + '%';
        btnDownload.onclick = function () {
          downloadBytes(resultBytes, baseName + '_compressed.mp3', 'audio/mpeg');
        };
        lpFill.style.width   = '100%';
        loadProgress.hidden  = true;
        resultCard.hidden    = false;
        btnCompress.disabled = false;
      })
      .catch(function (err) {
        loadProgress.hidden  = true;
        btnCompress.disabled = false;
        alert('Błąd kompresji: ' + ((err && err.message) ? err.message : String(err)));
      });
  });

  btnNewFile.addEventListener('click', function () {
    fileBytes   = null;
    resultBytes = null;
    dropzone.hidden     = false;
    workspace.hidden    = true;
    resultCard.hidden   = true;
    loadProgress.hidden = true;
    btnCompress.disabled = false;
  });

  function fmtSize(bytes) {
    if (bytes < 1024)    return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
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
