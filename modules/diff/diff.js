/* Moduł: porównanie dokumentów.
   Wszystko liczy się w przeglądarce — żaden bajt nie wychodzi na sieć. */
(function () {
'use strict';

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ---------- algorytm Myersa ---------- */
function myers(A, B) {
  var N = A.length, M = B.length, i;
  if (!N && !M) return [];
  if (!N) return B.map(function (_, j) { return { t: 'ins', a: null, b: j }; });
  if (!M) return A.map(function (_, k) { return { t: 'del', a: k, b: null }; });

  var MAX = N + M;
  if (MAX > 6000) {
    var out = [];
    for (i = 0; i < N; i++) out.push({ t: 'del', a: i, b: null });
    for (i = 0; i < M; i++) out.push({ t: 'ins', a: null, b: i });
    return out;
  }

  var off = MAX, v = new Int32Array(2 * MAX + 2), trace = [];
  for (var d = 0; d <= MAX; d++) {
    trace.push(v.slice());
    for (var k = -d; k <= d; k += 2) {
      var x;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      var y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) return backtrack(trace, d, off, N, M);
    }
  }
  return [];
}

function backtrack(trace, d, off, N, M) {
  var ops = [], x = N, y = M;
  for (var dd = d; dd > 0; dd--) {
    var v = trace[dd], k = x - y, pk;
    if (k === -dd || (k !== dd && v[off + k - 1] < v[off + k + 1])) pk = k + 1; else pk = k - 1;
    var px = v[off + pk], py = px - pk;
    while (x > px && y > py) { x--; y--; ops.push({ t: 'eq', a: x, b: y }); }
    if (x > px) { x--; ops.push({ t: 'del', a: x, b: null }); }
    else { y--; ops.push({ t: 'ins', a: null, b: y }); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ t: 'eq', a: x, b: y }); }
  while (x > 0) { x--; ops.push({ t: 'del', a: x, b: null }); }
  while (y > 0) { y--; ops.push({ t: 'ins', a: null, b: y }); }
  return ops.reverse();
}

/* ---------- przygotowanie tekstu ---------- */
function paragraphs(t) {
  return t.replace(/\r/g, '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
}
function words(p) { return p.match(/\S+/g) || []; }
function norm(s, o) {
  var t = s;
  if (o.punct) t = t.replace(/[.,;:!?()"'«»„”…—–\[\]{}-]/g, '');
  if (o.caseless) t = t.toLowerCase();
  return t;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  var bag = new Map(), hit = 0;
  a.forEach(function (w) { bag.set(w, (bag.get(w) || 0) + 1); });
  b.forEach(function (w) { var c = bag.get(w) || 0; if (c > 0) { hit++; bag.set(w, c - 1); } });
  return (2 * hit) / (a.length + b.length);
}

/* ---------- porównanie ---------- */
var rows = [], stats = { mod: 0, add: 0, del: 0, same: 0 };

function wordRow(oldP, newP, o) {
  var wa = words(oldP), wb = words(newP);
  var ops = myers(wa.map(function (w) { return norm(w, o); }), wb.map(function (w) { return norm(w, o); }));
  var oldHtml = '', newHtml = '', mergedHtml = '';
  ops.forEach(function (op) {
    if (op.t === 'eq') {
      oldHtml += esc(wa[op.a]) + ' ';
      newHtml += esc(wb[op.b]) + ' ';
      mergedHtml += esc(wb[op.b]) + ' ';
    } else if (op.t === 'del') {
      oldHtml += '<del>' + esc(wa[op.a]) + '</del> ';
      mergedHtml += '<del>' + esc(wa[op.a]) + '</del> ';
      stats.del++;
    } else {
      newHtml += '<ins>' + esc(wb[op.b]) + '</ins> ';
      mergedHtml += '<ins>' + esc(wb[op.b]) + '</ins> ';
      stats.add++;
    }
  });
  return { kind: 'mod', oldHtml: oldHtml, newHtml: newHtml, mergedHtml: mergedHtml };
}

function compare(textA, textB, o) {
  var pa = paragraphs(textA), pb = paragraphs(textB);
  var ops = myers(
    pa.map(function (p) { return norm(p, o); }),
    pb.map(function (p) { return norm(p, o); })
  );

  rows = []; stats = { mod: 0, add: 0, del: 0, same: 0 };
  var i = 0;

  while (i < ops.length) {
    if (ops[i].t === 'eq') {
      rows.push({ kind: 'same', old: pa[ops[i].a], neu: pb[ops[i].b] });
      stats.same++; i++;
      continue;
    }
    var dels = [], inss = [];
    while (i < ops.length && ops[i].t !== 'eq') {
      if (ops[i].t === 'del') dels.push(ops[i].a); else inss.push(ops[i].b);
      i++;
    }
    var n = Math.min(dels.length, inss.length), used = 0;
    for (var j = 0; j < n; j++) {
      var wa = words(pa[dels[j]]).map(function (w) { return norm(w, o); });
      var wb = words(pb[inss[j]]).map(function (w) { return norm(w, o); });
      if (similarity(wa, wb) >= 0.35) {
        rows.push(wordRow(pa[dels[j]], pb[inss[j]], o));
        stats.mod++; used++;
      } else break;
    }
    for (var d2 = used; d2 < dels.length; d2++) {
      rows.push({ kind: 'del', old: pa[dels[d2]], neu: null });
      stats.del += words(pa[dels[d2]]).length;
    }
    for (var a2 = used; a2 < inss.length; a2++) {
      rows.push({ kind: 'add', old: null, neu: pb[inss[a2]] });
      stats.add += words(pb[inss[a2]]).length;
    }
  }
}

/* ---------- render ---------- */
var view = 'side';
var grid = document.getElementById('grid');
var panes = document.getElementById('panes');
var mapbar = document.getElementById('mapbar');

function render() {
  var merged = view === 'merged';
  grid.className = 'grid' + (merged ? ' merged' : '');
  panes.className = 'panes' + (merged ? ' merged' : '');
  document.getElementById('headOld').style.display = merged ? 'none' : '';
  document.getElementById('headNew').textContent = merged
    ? 'Zmiany naniesione na nową wersję' : 'Wersja nowsza';

  var html = rows.map(function (r, idx) {
    var gut = '<div class="gutter-cell ' + (r.kind === 'same' ? '' : r.kind) + '"></div>';
    if (merged) {
      var body;
      if (r.kind === 'same') body = esc(r.neu);
      else if (r.kind === 'mod') body = r.mergedHtml;
      else if (r.kind === 'add') body = '<ins>' + esc(r.neu) + '</ins>';
      else body = '<del>' + esc(r.old) + '</del>';
      return gut + '<div class="cell" id="r' + idx + '">' + body + '</div>';
    }
    var L, R, cls = '';
    if (r.kind === 'same') { L = esc(r.old); R = esc(r.neu); }
    else if (r.kind === 'mod') { L = r.oldHtml; R = r.newHtml; }
    else if (r.kind === 'add') { L = ''; R = '<ins>' + esc(r.neu) + '</ins>'; cls = 'row-add'; }
    else { L = '<del>' + esc(r.old) + '</del>'; R = ''; cls = 'row-del'; }
    return '<div class="cell side-old ' + (L ? '' : 'empty') + ' ' + cls + '" id="r' + idx + '">' + L + '</div>'
      + gut
      + '<div class="cell side-new ' + (R ? '' : 'empty') + ' ' + cls + '">' + R + '</div>';
  }).join('');

  grid.innerHTML = html || '<div class="empty-state">Brak treści do porównania.</div>';
  drawMap();
}

function drawMap() {
  var changed = rows.map(function (r, i) { return { r: r, i: i }; })
                    .filter(function (o) { return o.r.kind !== 'same'; });
  if (!changed.length) { mapbar.className = 'mapbar'; mapbar.innerHTML = ''; return; }
  mapbar.className = 'mapbar on';
  mapbar.innerHTML = changed.map(function (o) {
    var top = (o.i / rows.length) * 100;
    return '<button class="mapmark ' + o.r.kind + '" style="top:calc(' + top.toFixed(2) + '% + 4px)"'
      + ' title="Akapit ' + (o.i + 1) + '" data-go="' + o.i + '"></button>';
  }).join('');
}

mapbar.addEventListener('click', function (e) {
  var b = e.target.closest('[data-go]');
  if (!b) return;
  var el = document.getElementById('r' + b.dataset.go);
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

/* ---------- odczyt plików ---------- */
async function readFile(file) {
  var ext = (file.name.split('.').pop() || '').toLowerCase();

  if (ext === 'docx') {
    if (!window.mammoth) throw new Error('brak obsługi DOCX.');
    var buf = await file.arrayBuffer();
    var res = await window.mammoth.extractRawText({ arrayBuffer: buf });
    return res.value;
  }

  if (ext === 'pdf') {
    if (!window.pdfjsLib) throw new Error('brak obsługi PDF.');
    var pbuf = await file.arrayBuffer();
    var doc = await window.pdfjsLib.getDocument({ data: pbuf }).promise;
    var out = [];
    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var tc = await page.getTextContent();
      var line = '', lastY = null;
      tc.items.forEach(function (it) {
        var y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 3) { out.push(line.trim()); line = ''; }
        line += it.str + ' ';
        lastY = y;
      });
      if (line.trim()) out.push(line.trim());
    }
    if (!out.join('').trim()) throw new Error('ten PDF nie zawiera warstwy tekstowej (skan).');
    return out.join('\n');
  }

  return await file.text();
}

/* ---------- podłączenie ---------- */
var els = {
  A: { ta: document.getElementById('textA'), drop: document.getElementById('dropA'), file: document.getElementById('fileA'), name: document.getElementById('nameA'), err: document.getElementById('errA') },
  B: { ta: document.getElementById('textB'), drop: document.getElementById('dropB'), file: document.getElementById('fileB'), name: document.getElementById('nameB'), err: document.getElementById('errB') }
};
var runBtn = document.getElementById('run');

function refreshRun() {
  runBtn.disabled = !(els.A.ta.value.trim() && els.B.ta.value.trim());
}

async function load(k, file) {
  var s = els[k];
  s.err.hidden = true;
  s.name.textContent = 'wczytywanie…';
  try {
    s.ta.value = await readFile(file);
    s.name.textContent = file.name;
  } catch (err) {
    s.name.textContent = '';
    s.err.textContent = 'Nie udało się odczytać pliku: ' + err.message + ' Wklej treść ręcznie.';
    s.err.hidden = false;
  }
  refreshRun();
}

['A', 'B'].forEach(function (k) {
  var s = els[k];
  s.ta.addEventListener('input', function () { s.name.textContent = ''; refreshRun(); });
  s.file.addEventListener('change', function (e) {
    if (e.target.files[0]) load(k, e.target.files[0]);
    e.target.value = '';
  });
  s.drop.addEventListener('dragover', function (e) { e.preventDefault(); s.drop.classList.add('over'); });
  s.drop.addEventListener('dragleave', function () { s.drop.classList.remove('over'); });
  s.drop.addEventListener('drop', function (e) {
    e.preventDefault(); s.drop.classList.remove('over');
    if (e.dataTransfer.files[0]) load(k, e.dataTransfer.files[0]);
  });
});

document.querySelectorAll('[data-open]').forEach(function (b) {
  b.addEventListener('click', function () { els[b.dataset.open].file.click(); });
});

runBtn.addEventListener('click', function () {
  compare(els.A.ta.value, els.B.ta.value, {
    caseless: document.getElementById('optCase').checked,
    punct: document.getElementById('optPunct').checked
  });
  document.getElementById('sMod').textContent = stats.mod;
  document.getElementById('sAdd').textContent = stats.add;
  document.getElementById('sDel').textContent = stats.del;
  document.getElementById('sSame').textContent = stats.same;
  document.getElementById('result').classList.add('on');
  render();
});

document.getElementById('viewSide').addEventListener('click', function () {
  view = 'side';
  this.setAttribute('aria-pressed', 'true');
  document.getElementById('viewMerged').setAttribute('aria-pressed', 'false');
  render();
});
document.getElementById('viewMerged').addEventListener('click', function () {
  view = 'merged';
  this.setAttribute('aria-pressed', 'true');
  document.getElementById('viewSide').setAttribute('aria-pressed', 'false');
  render();
});

document.getElementById('cp').addEventListener('click', async function () {
  var msg = document.getElementById('cpMsg');
  var txt = 'Porównanie dokumentów — ' + stats.mod + ' zmienionych akapitów, '
    + stats.add + ' dodanych słów, ' + stats.del + ' usuniętych słów, '
    + stats.same + ' akapitów bez zmian.';
  try { await navigator.clipboard.writeText(txt); msg.textContent = 'Skopiowano.'; }
  catch (e) { msg.textContent = 'Kopiowanie niedostępne w tej przeglądarce.'; }
  setTimeout(function () { msg.textContent = ''; }, 2500);
});

document.getElementById('dl').addEventListener('click', function () {
  var body = rows.map(function (r) {
    if (r.kind === 'same') return '<p>' + esc(r.neu) + '</p>';
    if (r.kind === 'mod') return '<p>' + r.mergedHtml + '</p>';
    if (r.kind === 'add') return '<p><ins>' + esc(r.neu) + '</ins></p>';
    return '<p><del>' + esc(r.old) + '</del></p>';
  }).join('\n');

  var doc = '<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8">'
    + '<title>Raport porównania</title><style>'
    + "body{font-family:'Space Grotesk',system-ui,sans-serif;max-width:820px;margin:40px auto;"
    + 'padding:0 20px;line-height:1.62;color:#1A1A1A;background:#E8E6E1}'
    + 'ins{background:#DDEBE6;color:#0B6951;text-decoration:none}'
    + 'del{background:#F4DFE3;color:#8C2438}'
    + 'h1{font-size:19px;font-weight:500}'
    + '.meta{font-size:13px;color:#6B7280;margin-bottom:26px}'
    + '</style></head><body><h1>Raport porównania dokumentów</h1><div class="meta">'
    + stats.mod + ' zmienionych akapitów · ' + stats.add + ' dodanych słów · '
    + stats.del + ' usuniętych słów · ' + stats.same + ' bez zmian · '
    + new Date().toLocaleString('pl-PL')
    + '<br>Wygenerowano lokalnie w przeglądarce — tools.aizyl.pl</div>'
    + body + '</body></html>';

  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
  a.download = 'porownanie-dokumentow.html';
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
});

/* przykład, żeby pierwszy ekran nie był pusty */
els.A.ta.value = [
  'Umowa o świadczenie usług',
  '§1. Wykonawca zobowiązuje się do wykonania usługi w terminie 14 dni roboczych od dnia podpisania umowy.',
  '§2. Zamawiający zapłaci wynagrodzenie w wysokości 12 000 zł netto w terminie 14 dni od doręczenia faktury.',
  '§3. Wykonawca ponosi odpowiedzialność za szkody wyrządzone Zamawiającemu do wysokości otrzymanego wynagrodzenia.',
  '§4. Wszelkie zmiany umowy wymagają formy pisemnej pod rygorem nieważności.'
].join('\n');
els.B.ta.value = [
  'Umowa o świadczenie usług',
  '§1. Wykonawca zobowiązuje się do wykonania usługi w terminie 21 dni roboczych od dnia podpisania umowy.',
  '§2. Zamawiający zapłaci wynagrodzenie w wysokości 12 000 zł netto w terminie 30 dni od doręczenia faktury.',
  '§3. Wykonawca ponosi odpowiedzialność za szkody wyrządzone Zamawiającemu bez ograniczenia kwotowego.',
  '§4. Wszelkie zmiany umowy wymagają formy pisemnej pod rygorem nieważności.',
  '§5. Zamawiający może odstąpić od umowy w każdym czasie bez podania przyczyny.'
].join('\n');
refreshRun();

})();
