/**
 * trim-video.js - Przycinanie wideo
 * FFmpeg.wasm (FFmpegWASM UMD global). Zero danych wychodzi z przegladarki.
 */
(function () {
  'use strict';

  var FFMPEG_CORE = '/shared/ffmpeg/core/ffmpeg-core.js';
  var FFMPEG_WASM = '/shared/ffmpeg/core/ffmpeg-core.wasm';

  var fileName    = '';
  var fileSize    = 0;
  var fileBytes   = null;
  var duration    = 0;
  var resultBytes = null;
  var objectURL   = null;
  var ff          = null;

  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var fileInfo     = document.getElementById('fileInfo');
  var videoPreview = document.getElementById('videoPreview');
  var inputStart   = document.getElementById('inputStart');
  var inputEnd     = document.getElementById('inputEnd');
  var trimDuration = document.getElementById('trimDuration');
  var btnTrim      = document.getElementById('btnTrim');
  var btnNewFile   = document.getElementById('btnNewFile');
  var loadProgress = document.getElementById('loadProgress');
  var lpFill       = document.getElementById('lpFill');
  var lpLabel      = document.getElementById('lpLabel');
  var resultCard   = document.getElementById('resultCard');
  var sizeBefore   = document.getElementById('sizeBefore');
  var sizeAfter    = document.getElementById('sizeAfter');
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
    var isVideo = f.type.startsWith('video/') ||
      /\.(mp4|mkv|avi|mov|webm|m4v|flv|wmv)$/i.test(f.name);
    if (!isVideo) {
      alert('Wybierz plik wideo (MP4, MKV, AVI, MOV, WebM).');
      return;
    }
    fileName = f.name;
    fileSize = f.size;
    resultBytes = null;

    if (objectURL) { URL.revokeObjectURL(objectURL); }
    objectURL = URL.createObjectURL(f);
    videoPreview.src = objectURL;

    videoPreview.onloadedmetadata = function () {
      duration = videoPreview.duration;
      inputStart.max  = duration.toFixed(1);
      inputEnd.max    = duration.toFixed(1);
      inputEnd.value  = duration.toFixed(1);
      updateDuration();
    };

    var reader = new FileReader();
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
    btnTrim.disabled    = false;
    fileInfo.innerHTML =
      '<span class="ti ti-file-type-mp4"></span> ' +
      '<strong>' + esc(fileName) + '</strong>' +
      ' <span class="fi-size">(' + fmtSize(fileSize) + ')</span>';
  }

  function updateDuration() {
    if (!duration) return;
    var start = parseFloat(inputStart.value) || 0;
    var end   = parseFloat(inputEnd.value)   || duration;
    start = Math.max(0, Math.min(start, duration));
    end   = Math.max(0, Math.min(end,   duration));
    if (end <= start) {
      trimDuration.textContent = 'Czas konca musi byc wiekszy niz czas poczatku.';
      return;
    }
    trimDuration.textContent = 'Dlugosc wycinanego fragmentu: ' + fmtTime(end - start);
  }

  inputStart.addEventListener('input', updateDuration);
  inputEnd.addEventListener('input', updateDuration);

  function initFFmpeg() {
    if (ff && ff.loaded) return Promise.resolve();
    var FFmpegClass = FFmpegWASM.FFmpeg;
    ff = new FFmpegClass();
    ff.on('progress', function (p) {
      var pct = Math.min(95, Math.round((p.progress || 0) * 100));
      lpFill.style.width = pct + '%';
      if (pct > 0) lpLabel.textContent = 'Przycinam... ' + pct + '%';
    });
    lpFill.style.width  = '0%';
    lpLabel.textContent = 'Laduje silnik konwersji...';
    return ff.load({ coreURL: FFMPEG_CORE, wasmURL: FFMPEG_WASM });
  }

  btnTrim.addEventListener('click', function () {
    if (!fileBytes) return;

    var start = parseFloat(inputStart.value) || 0;
    var end   = parseFloat(inputEnd.value)   || duration;
    start = Math.max(0, Math.min(start, duration));
    end   = Math.max(0, Math.min(end,   duration));

    if (end <= start) {
      alert('Czas konca musi byc wiekszy niz czas poczatku.');
      return;
    }

    btnTrim.disabled    = true;
    loadProgress.hidden = false;
    resultCard.hidden   = true;
    lpFill.style.width  = '0%';
    lpLabel.textContent = 'Przygotowuje...';

    var ext        = (fileName.split('.').pop() || 'mp4').toLowerCase();
    var inputName  = 'input.' + ext;
    var outputName = 'output.mp4';
    var startStr   = toFFmpegTime(start);
    var durStr     = toFFmpegTime(end - start);

    initFFmpeg()
      .then(function () {
        lpLabel.textContent = 'Wczytuje plik...';
        return ff.writeFile(inputName, fileBytes);
      })
      .then(function () {
        lpLabel.textContent = 'Przycinam...';
        return ff.exec([
          '-ss', startStr,
          '-i', inputName,
          '-t', durStr,
          '-c', 'copy',
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
        sizeBefore.textContent = fmtTime(duration);
        sizeAfter.textContent  = fmtTime(end - start);
        btnDownload.onclick = function () {
          downloadBytes(resultBytes, baseName + '_przyciete.mp4', 'video/mp4');
        };
        lpFill.style.width  = '100%';
        loadProgress.hidden = true;
        resultCard.hidden   = false;
        btnTrim.disabled    = false;
      })
      .catch(function (err) {
        loadProgress.hidden = true;
        btnTrim.disabled    = false;
        alert('Blad przycinania: ' + ((err && err.message) ? err.message : String(err)));
      });
  });

  btnNewFile.addEventListener('click', function () {
    fileBytes   = null;
    resultBytes = null;
    duration    = 0;
    if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
    videoPreview.src    = '';
    dropzone.hidden     = false;
    workspace.hidden    = true;
    resultCard.hidden   = true;
    loadProgress.hidden = true;
    btnTrim.disabled    = false;
  });

  function toFFmpegTime(sec) {
    var h  = Math.floor(sec / 3600);
    var m  = Math.floor((sec % 3600) / 60);
    var s  = (sec % 60).toFixed(2);
    return pad(h) + ':' + pad(m) + ':' + (parseFloat(s) < 10 ? '0' : '') + s;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function fmtSize(bytes) {
    if (bytes < 1024)    return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function fmtTime(sec) {
    var m  = Math.floor(sec / 60);
    var s  = Math.floor(sec % 60);
    var ms = Math.round((sec % 1) * 10);
    return m + ':' + (s < 10 ? '0' : '') + s + '.' + ms;
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
