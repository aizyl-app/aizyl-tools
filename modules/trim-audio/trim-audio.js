/**
 * trim-audio.js — Przycinanie audio
 * Web Audio API + ręczny WAV encoder. Zero zależności zewnętrznych.
 * Żadne dane użytkownika nie opuszczają przeglądarki.
 */
(function () {
  'use strict';

  /* —— Stan aplikacji ——————————————————————————————————————————————— */
  var fileName    = '';
  var fileSize    = 0;
  var audioBuf    = null;
  var objectURL   = null;

  /* —— Elementy DOM ————————————————————————————————————————————————— */
  var dropzone     = document.getElementById('dropzone');
  var picker       = document.getElementById('picker');
  var workspace    = document.getElementById('workspace');
  var fileInfo     = document.getElementById('fileInfo');
  var audioPreview = document.getElementById('audioPreview');
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
    var isAudio = f.type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|m4a|flac|aac|opus|weba)$/i.test(f.name);
    if (!isAudio) {
      alert('Wybierz plik audio (MP3, WAV, OGG, M4A, FLAC).');
      return;
    }
    fileName = f.name;
    fileSize = f.size;

    if (objectURL) { URL.revokeObjectURL(objectURL); }
    objectURL = URL.createObjectURL(f);
    audioPreview.src = objectURL;

    var reader = new FileReader();
    reader.onload = function (ev) {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.decodeAudioData(ev.target.result, function (buf) {
        audioBuf = buf;
        var dur = buf.duration;
        inputStart.max = dur.toFixed(1);
        inputEnd.max   = dur.toFixed(1);
        inputEnd.value = dur.toFixed(1);
        updateDuration();
        showWorkspace();
        ctx.close();
      }, function () {
        alert('Nie udało się odczytać pliku audio. Sprawdź format.');
      });
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
      '<span class="ti ti-file-music"></span> ' +
      '<strong>' + esc(fileName) + '</strong>' +
      ' <span class="fi-size">(' + fmtSize(fileSize) + ' · ' + fmtTime(audioBuf.duration) + ')</span>';
  }

  /* —— Aktualizacja podglądu czasu —————————————————————————————————— */
  function updateDuration() {
    if (!audioBuf) return;
    var start = parseFloat(inputStart.value) || 0;
    var end   = parseFloat(inputEnd.value)   || audioBuf.duration;
    start = Math.max(0, Math.min(start, audioBuf.duration));
    end   = Math.max(0, Math.min(end,   audioBuf.duration));
    if (end <= start) {
      trimDuration.textContent = 'Czas końca musi być większy niż czas początku.';
      return;
    }
    trimDuration.textContent = 'Długość wycinanego fragmentu: ' + fmtTime(end - start);
  }

  inputStart.addEventListener('input', updateDuration);
  inputEnd.addEventListener('input', updateDuration);

  /* —— Przycinanie ————————————————————————————————————————————————— */
  btnTrim.addEventListener('click', function () {
    if (!audioBuf) return;

    var start = parseFloat(inputStart.value) || 0;
    var end   = parseFloat(inputEnd.value)   || audioBuf.duration;
    start = Math.max(0, Math.min(start, audioBuf.duration));
    end   = Math.max(0, Math.min(end,   audioBuf.duration));

    if (end <= start) {
      alert('Czas końca musi być większy niż czas początku.');
      return;
    }

    btnTrim.disabled    = true;
    loadProgress.hidden = false;
    resultCard.hidden   = true;
    lpFill.style.width  = '30%';
    lpLabel.textContent = 'Przycinam...';

    setTimeout(function () {
      try {
        var sampleRate  = audioBuf.sampleRate;
        var numChannels = audioBuf.numberOfChannels;
        var startSample = Math.floor(start * sampleRate);
        var endSample   = Math.floor(end   * sampleRate);
        var frameCount  = endSample - startSample;

        var offCtx = new OfflineAudioContext(numChannels, frameCount, sampleRate);
        var channels = [];
        for (var ch = 0; ch < numChannels; ch++) {
          channels.push(audioBuf.getChannelData(ch).slice(startSample, endSample));
        }

        lpFill.style.width  = '60%';
        lpLabel.textContent = 'Koduję WAV...';

        var wavBuf  = encodeWAV(channels, sampleRate, numChannels, frameCount);
        var wavBlob = new Blob([wavBuf], { type: 'audio/wav' });

        lpFill.style.width = '100%';

        var baseName = fileName.replace(/\.[^.]+$/, '');
        sizeBefore.textContent = fmtTime(audioBuf.duration);
        sizeAfter.textContent  = fmtTime(end - start);

        btnDownload.onclick = function () {
          var url = URL.createObjectURL(wavBlob);
          var a   = document.createElement('a');
          a.href     = url;
          a.download = baseName + '_przyciete.wav';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        };

        loadProgress.hidden = true;
        resultCard.hidden   = false;
        btnTrim.disabled    = false;
      } catch (err) {
        loadProgress.hidden = true;
        btnTrim.disabled    = false;
        alert('Błąd przycinania: ' + (err.message || String(err)));
      }
    }, 50);
  });

  /* —— Nowy plik ——————————————————————————————————————————————————— */
  btnNewFile.addEventListener('click', function () {
    audioBuf  = null;
    if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
    audioPreview.src    = '';
    dropzone.hidden     = false;
    workspace.hidden    = true;
    resultCard.hidden   = true;
    loadProgress.hidden = true;
    btnTrim.disabled    = false;
  });

  /* —— WAV encoder ————————————————————————————————————————————————— */
  function encodeWAV(channels, sampleRate, numChannels, numSamples) {
    var bitDepth  = 16;
    var byteRate  = sampleRate * numChannels * bitDepth / 8;
    var blockAlign = numChannels * bitDepth / 8;
    var dataSize  = numSamples * numChannels * bitDepth / 8;
    var buf       = new ArrayBuffer(44 + dataSize);
    var view      = new DataView(buf);

    writeStr(view, 0,  'RIFF');
    view.setUint32(4,  36 + dataSize, true);
    writeStr(view, 8,  'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1,  true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate,  true);
    view.setUint32(28, byteRate,    true);
    view.setUint16(32, blockAlign,  true);
    view.setUint16(34, bitDepth,    true);
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    var offset = 44;
    for (var i = 0; i < numSamples; i++) {
      for (var ch = 0; ch < numChannels; ch++) {
        var s = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
    }
    return buf;
  }

  function writeStr(view, offset, str) {
    for (var i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /* —— Helpers ————————————————————————————————————————————————————— */
  function fmtSize(bytes) {
    if (bytes < 1024)    return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    var ms = Math.round((sec % 1) * 10);
    return m + ':' + (s < 10 ? '0' : '') + s + '.' + ms;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
  }
})();
