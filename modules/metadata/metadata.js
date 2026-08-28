/* Moduł: czyszczenie metadanych.
   Czytanie i usuwanie odbywa się na bajtach pliku — obraz nie jest kodowany ponownie,
   więc jakość zostaje nietknięta. Nic nie wychodzi na sieć. */
(function () {
'use strict';

/* ================= EXIF ================= */

var TAGS_IFD0 = {
  0x010F: 'Producent urządzenia',
  0x0110: 'Model urządzenia',
  0x0131: 'Oprogramowanie',
  0x0132: 'Data modyfikacji',
  0x013B: 'Autor',
  0x8298: 'Prawa autorskie',
  0x9C9B: 'Tytuł (Windows)',
  0x9C9C: 'Komentarz (Windows)',
  0x9C9D: 'Autor (Windows)',
  0x9C9E: 'Znaczniki (Windows)'
};
var TAGS_EXIF = {
  0x9003: 'Data wykonania',
  0x9004: 'Data zapisu',
  0xA430: 'Właściciel aparatu',
  0xA431: 'Numer seryjny aparatu',
  0xA433: 'Producent obiektywu',
  0xA434: 'Model obiektywu',
  0xA435: 'Numer seryjny obiektywu',
  0x9286: 'Komentarz użytkownika'
};
var TAGS_GPS = {
  0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude',
  0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude',
  0x0005: 'GPSAltitudeRef', 0x0006: 'GPSAltitude',
  0x001D: 'GPSDateStamp'
};
var TYPE_SIZE = { 1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8 };

function readValue(dv, entry, tiff, le) {
  var type = dv.getUint16(entry + 2, le);
  var count = dv.getUint32(entry + 4, le);
  var size = TYPE_SIZE[type];
  if (!size) return null;
  var total = size * count;
  var at = total <= 4 ? entry + 8 : tiff + dv.getUint32(entry + 8, le);
  if (at < 0 || at + total > dv.byteLength) return null;

  var i, out;
  if (type === 2) {
    out = '';
    for (i = 0; i < count; i++) {
      var ch = dv.getUint8(at + i);
      if (!ch) break;
      out += String.fromCharCode(ch);
    }
    return out.trim();
  }
  if (type === 5 || type === 10) {
    out = [];
    for (i = 0; i < count; i++) {
      var num = le ? dv.getUint32(at + i * 8, true) : dv.getUint32(at + i * 8, false);
      var den = le ? dv.getUint32(at + i * 8 + 4, true) : dv.getUint32(at + i * 8 + 4, false);
      out.push(den ? num / den : 0);
    }
    return count === 1 ? out[0] : out;
  }
  if (type === 3) return dv.getUint16(at, le);
  if (type === 4) return dv.getUint32(at, le);
  if (type === 1 || type === 7) return count === 1 ? dv.getUint8(at) : '(dane binarne)';
  return null;
}

function walkIFD(dv, offset, tiff, le, map, into, pointers) {
  if (offset + 2 > dv.byteLength) return;
  var count = dv.getUint16(offset, le);
  for (var i = 0; i < count; i++) {
    var entry = offset + 2 + i * 12;
    if (entry + 12 > dv.byteLength) return;
    var tag = dv.getUint16(entry, le);

    if (pointers && (tag === 0x8769 || tag === 0x8825)) {
      var ptr = dv.getUint32(entry + 8, le);
      pointers[tag === 0x8769 ? 'exif' : 'gps'] = tiff + ptr;
      continue;
    }
    if (tag === 0x927C) { into['Notatka producenta'] = '(obecna)'; continue; }
    if (!map[tag]) continue;
    var v = readValue(dv, entry, tiff, le);
    if (v !== null && v !== '' && v !== undefined) into[map[tag]] = v;
  }
}

function parseTiff(buf, tiff) {
  var dv = new DataView(buf);
  if (tiff + 8 > dv.byteLength) return null;
  var bom = dv.getUint16(tiff, false);
  var le = bom === 0x4949;
  if (bom !== 0x4949 && bom !== 0x4D4D) return null;
  if (dv.getUint16(tiff + 2, le) !== 0x002A) return null;

  var ifd0 = tiff + dv.getUint32(tiff + 4, le);
  var flat = {}, gpsRaw = {}, ptrs = {};
  walkIFD(dv, ifd0, tiff, le, TAGS_IFD0, flat, ptrs);
  if (ptrs.exif) walkIFD(dv, ptrs.exif, tiff, le, TAGS_EXIF, flat, null);
  if (ptrs.gps) walkIFD(dv, ptrs.gps, tiff, le, TAGS_GPS, gpsRaw, null);

  return { fields: flat, gps: buildGps(gpsRaw) };
}

function buildGps(g) {
  if (!g.GPSLatitude || !g.GPSLongitude) return null;
  function dec(parts, ref) {
    if (!Array.isArray(parts) || parts.length < 3) return null;
    var v = parts[0] + parts[1] / 60 + parts[2] / 3600;
    if (ref === 'S' || ref === 'W') v = -v;
    return v;
  }
  var lat = dec(g.GPSLatitude, g.GPSLatitudeRef);
  var lon = dec(g.GPSLongitude, g.GPSLongitudeRef);
  if (lat === null || lon === null) return null;
  return { lat: lat, lon: lon, date: g.GPSDateStamp || null };
}

/* ================= JPEG ================= */

var STRIP_MARKERS = [0xE1, 0xE2, 0xEC, 0xED, 0xEE, 0xEF, 0xFE]; // APP1,APP2,APP12,APP13,APP14,APP15,COM

function readJpeg(buf) {
  var dv = new DataView(buf), p = 2;
  var res = { format: 'JPEG', fields: {}, gps: null, extras: [], strip: [], supported: true };
  if (dv.getUint16(0, false) !== 0xFFD8) { res.supported = false; return res; }

  while (p + 4 <= dv.byteLength) {
    if (dv.getUint8(p) !== 0xFF) break;
    var marker = dv.getUint8(p + 1);
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; }
    if (marker === 0xDA || marker === 0xD9) break; // dane obrazu
    var len = dv.getUint16(p + 2, false);
    if (len < 2) break;
    var dataAt = p + 4, dataLen = len - 2;

    if (STRIP_MARKERS.indexOf(marker) >= 0) {
      var sig = '';
      for (var i = 0; i < Math.min(dataLen, 30); i++) sig += String.fromCharCode(dv.getUint8(dataAt + i));

      if (marker === 0xE1 && sig.indexOf('Exif') === 0) {
        var parsed = parseTiff(buf, dataAt + 6);
        if (parsed) { Object.assign(res.fields, parsed.fields); if (parsed.gps) res.gps = parsed.gps; }
      } else if (marker === 0xE1 && sig.indexOf('http://ns.adobe.com/xap') === 0) {
        res.extras.push('Blok XMP (opis Adobe)');
      } else if (marker === 0xED) {
        res.extras.push('Blok IPTC / Photoshop');
      } else if (marker === 0xEE) {
        res.extras.push('Blok Adobe');
      } else if (marker === 0xFE) {
        res.extras.push('Komentarz w pliku');
      } else if (marker === 0xE2) {
        res.extras.push('Profil kolorów lub dane dodatkowe');
      }
      res.strip.push({ from: p, to: p + 2 + len });
    }
    p += 2 + len;
  }
  return res;
}

function cleanJpeg(buf, strip) {
  var src = new Uint8Array(buf);
  if (!strip.length) return src;
  var keep = [], cursor = 0;
  strip.sort(function (a, b) { return a.from - b.from; });
  strip.forEach(function (s) {
    if (s.from > cursor) keep.push(src.subarray(cursor, s.from));
    cursor = s.to;
  });
  if (cursor < src.length) keep.push(src.subarray(cursor));
  var total = keep.reduce(function (n, a) { return n + a.length; }, 0);
  var out = new Uint8Array(total), off = 0;
  keep.forEach(function (a) { out.set(a, off); off += a.length; });
  return out;
}

/* ================= PNG ================= */

var PNG_STRIP = ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'iCCP'];

function readPng(buf) {
  var dv = new DataView(buf), u8 = new Uint8Array(buf);
  var res = { format: 'PNG', fields: {}, gps: null, extras: [], strip: [], supported: true };
  var sigOk = [137, 80, 78, 71, 13, 10, 26, 10].every(function (b, i) { return u8[i] === b; });
  if (!sigOk) { res.supported = false; return res; }

  var p = 8;
  while (p + 8 <= dv.byteLength) {
    var len = dv.getUint32(p, false);
    var type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    var dataAt = p + 8;
    if (type === 'IEND') break;

    if (PNG_STRIP.indexOf(type) >= 0) {
      if (type === 'eXIf') {
        var parsed = parseTiff(buf, dataAt);
        if (parsed) { Object.assign(res.fields, parsed.fields); if (parsed.gps) res.gps = parsed.gps; }
      } else if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
        var kw = '';
        for (var i = 0; i < Math.min(len, 79); i++) {
          var c = u8[dataAt + i];
          if (!c) break;
          kw += String.fromCharCode(c);
        }
        var val = '';
        if (type === 'tEXt') {
          for (var j = kw.length + 1; j < len; j++) val += String.fromCharCode(u8[dataAt + j]);
        }
        if (val.trim()) res.fields[kw || 'Opis'] = val.trim().slice(0, 300);
        else res.extras.push('Pole tekstowe: ' + (kw || 'bez nazwy'));
      } else if (type === 'tIME') {
        res.extras.push('Znacznik czasu modyfikacji');
      } else if (type === 'iCCP') {
        res.extras.push('Profil kolorów');
      }
      res.strip.push({ from: p, to: dataAt + len + 4 });
    }
    p = dataAt + len + 4;
  }
  return res;
}

/* ================= UI ================= */

var results = document.getElementById('results');
var dropzone = document.getElementById('dropzone');
var picker = document.getElementById('picker');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function kb(n) {
  return n < 1024 ? n + ' B' : (n / 1024).toFixed(1).replace('.', ',') + ' KB';
}

function group(title, rows) {
  if (!rows.length) return '';
  return '<div class="fgroup"><h3>' + title + '</h3>' + rows.join('') + '</div>';
}
function row(k, v, alarm) {
  return '<div class="frow"><div class="fkey">' + esc(k) + '</div>'
    + '<div class="fval' + (alarm ? ' alarm' : '') + '">' + esc(v) + '</div></div>';
}

function card(file, res, cleaned) {
  var id = 'f' + Math.random().toString(36).slice(2, 9);
  var saved = res.supported ? file.size - cleaned.length : 0;
  var count = Object.keys(res.fields).length + res.extras.length + (res.gps ? 1 : 0);

  var where = [], what = [], when = [], who = [], other = [];
  if (res.gps) {
    where.push(row('Współrzędne',
      res.gps.lat.toFixed(6) + ', ' + res.gps.lon.toFixed(6), true));
    if (res.gps.date) where.push(row('Data GPS', res.gps.date));
  }
  Object.keys(res.fields).forEach(function (k) {
    var v = res.fields[k];
    if (typeof v === 'number') v = String(v);
    if (Array.isArray(v)) v = v.join(', ');
    if (/Data/.test(k)) when.push(row(k, v));
    else if (/urządzeni|obiekty|seryjn/i.test(k)) what.push(row(k, v, /seryjn/i.test(k)));
    else if (/Autor|Właściciel|autorskie/i.test(k)) who.push(row(k, v, true));
    else other.push(row(k, v));
  });
  res.extras.forEach(function (e) { other.push(row(e, 'obecny')); });

  var verdict;
  if (!res.supported) {
    verdict = '<div class="verdict unknown"><span class="ti ti-help-circle"></span>'
      + 'Nieobsługiwany format. Na razie działają JPEG i PNG.</div>';
  } else if (!count) {
    verdict = '<div class="verdict clean"><span class="ti ti-circle-check"></span>'
      + 'Ten plik nie zawiera metadanych. Nic do usunięcia.</div>';
  } else if (res.gps) {
    verdict = '<div class="verdict dirty"><span class="ti ti-map-pin-filled"></span>'
      + 'Ten plik zdradza dokładne miejsce, w którym powstał.</div>';
  } else {
    verdict = '<div class="verdict dirty"><span class="ti ti-alert-triangle"></span>'
      + 'Znaleziono ' + count + (count === 1 ? ' zapis' : count < 5 ? ' zapisy' : ' zapisów')
      + ' opisujących ten plik.</div>';
  }

  var findings = group('Gdzie', where) + group('Czym', what)
    + group('Kiedy', when) + group('Kto', who) + group('Pozostałe', other);

  var action = (res.supported && count)
    ? '<button class="btn btn-primary" data-clean="' + id + '">Pobierz czysty plik</button>'
      + '<span class="savings">−' + kb(saved) + '</span>'
    : '';

  var el = document.createElement('div');
  el.className = 'file-card';
  el.innerHTML =
    '<div class="fc-head">'
    + '<img class="fc-thumb" alt="" src="' + URL.createObjectURL(file) + '">'
    + '<div class="fc-meta"><p class="fc-name">' + esc(file.name) + '</p>'
    + '<p class="fc-sub">' + res.format + ' · ' + kb(file.size) + '</p></div>'
    + '<div class="fc-actions">' + action + '</div>'
    + '</div>' + verdict
    + (findings ? '<div class="findings">' + findings + '</div>' : '');

  var btn = el.querySelector('[data-clean]');
  if (btn) {
    btn.addEventListener('click', function () {
      var name = file.name.replace(/(\.[^.]+)$/, '-bez-metadanych$1');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([cleaned], { type: file.type }));
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      btn.textContent = 'Pobrano';
      btn.disabled = true;
    });
  }
  return el;
}

async function handle(file) {
  var buf = await file.arrayBuffer();
  var ext = (file.name.split('.').pop() || '').toLowerCase();
  var res;

  if (ext === 'png') res = readPng(buf);
  else if (ext === 'jpg' || ext === 'jpeg') res = readJpeg(buf);
  else {
    res = { format: ext.toUpperCase() || 'nieznany', fields: {}, gps: null,
            extras: [], strip: [], supported: false };
  }

  var cleaned = res.supported ? cleanJpeg(buf, res.strip) : new Uint8Array(0);
  results.appendChild(card(file, res, cleaned));
}

function accept(list) {
  Array.prototype.forEach.call(list, function (f) {
    handle(f).catch(function (e) {
      var el = document.createElement('div');
      el.className = 'file-card';
      el.innerHTML = '<div class="verdict unknown" style="border-top:0">'
        + '<span class="ti ti-alert-circle"></span>Nie udało się odczytać pliku '
        + esc(f.name) + '.</div>';
      results.appendChild(el);
    });
  });
}

dropzone.addEventListener('click', function () { picker.click(); });
dropzone.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
});
picker.addEventListener('change', function (e) { accept(e.target.files); e.target.value = ''; });
dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('over'); });
dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('over'); });
dropzone.addEventListener('drop', function (e) {
  e.preventDefault(); dropzone.classList.remove('over');
  accept(e.dataTransfer.files);
});

})();
