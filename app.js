/* SanaVerse – UI. Library, player, text view, settings. */
import { LS, S, saveS, DB } from './storage.js';
import { engine, VOICES } from './tts.js';
import { extractPdf, AppError } from './extract.js';
import { Player, fmt } from './player.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 5000); }

let tab = 'listen', seeking = false, lastSec = -1, lastI = -1, lastStatus = 0, nativeDone = false;
const ui = { toast, onChange: () => upd(), onState: () => { renderPlay(); renderStatus(); }, onStatus: () => renderStatus(), onTick: () => { if (Date.now() - lastStatus > 1000) renderStatus(); }, onSleep: () => sleepUI() };
const P = new Player(ui);
window.SV = { P, S, engine, DB, LS }; // handy for debugging and automated tests

/* ---------- views ---------- */
function show(v) { $('#library').hidden = v !== 'library'; $('#book').hidden = v !== 'book'; document.body.classList.toggle('inbook', v === 'book'); window.scrollTo(0, 0); }
function busy(on, msg, pct) { $('#busy').hidden = !on; if (msg) $('#busyMsg').textContent = msg; $('#busyBar').style.width = (pct || 0) + '%'; }

/* ---------- import ---------- */
async function importFile(file) {
  if (!file) return;
  busy(true, 'Reading PDF…', 2);
  try {
    const { meta, text } = await extractPdf(file, (m, p) => busy(true, m, p));
    await DB.put(meta, text);
    navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {});
    busy(true, 'Ready to listen.', 100); busy(false); await openBook(meta.id);
  } catch (e) {
    busy(false);
    toast(e instanceof AppError ? e.message : (e && e.name === 'QuotaExceededError') ? 'Not enough storage space on this device for this book.' : 'Something went wrong reading this PDF. It may be damaged or unusual.');
    if (!(e instanceof AppError)) console.error(e);
  }
}

/* ---------- library ---------- */
function card(m, feat) {
  const d = h('article', 'card' + (feat ? ' feat' : '')), pc = m.p.pct || 0;
  if (feat) d.append(h('div', 'lbl', 'Continue Reading'));
  const head = h('div', 'head'), info = h('div');
  if (m.cover) { const im = h('img', 'cov'); im.src = m.cover; im.alt = ''; head.append(im); }
  info.append(h('h3', 'bt', m.title)); if (m.author) info.append(h('div', 'muted', m.author)); if (m.p.sec && pc > 0) info.append(h('div', 'muted small', m.p.sec));
  head.append(info); d.append(head);
  const bar = h('div', 'bar'), f = h('i'); f.style.width = pc + '%'; bar.append(f); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuenow', Math.round(pc)); d.append(bar);
  d.append(h('div', 'muted small', Math.round(pc) + '% listened' + (pc >= 99.5 ? ' · Finished' : '') + ` · ${m.pages} pages`));
  const row = h('div', 'row');
  const go = h('button', 'btn primary', pc >= 99.5 ? 'Listen again' : pc > 0 ? 'Continue' : 'Listen'); go.onclick = () => openBook(m.id); row.append(go);
  if (!feat) {
    const rs = h('button', 'btn', 'Restart'); rs.onclick = () => { LS.set('sv:p:' + m.id, { i: 0, o: 0, pct: 0, t: Date.now() }); renderLibrary(); };
    const dl = h('button', 'btn danger', 'Delete'); dl.onclick = async () => { if (!confirm(`Delete “${m.title}” and its audio from this device?`)) return; await DB.del(m.id).catch(() => {}); ['p', 'b'].forEach(k => LS.del(`sv:${k}:${m.id}`)); renderLibrary(); };
    row.append(rs, dl);
  }
  d.append(row); return d;
}
async function renderLibrary() {
  let metas = [];
  try { metas = await DB.metas(); } catch { toast('Your library couldn’t be opened. Private browsing can block storage.'); }
  metas.forEach(m => m.p = LS.get('sv:p:' + m.id, { i: 0, pct: 0, t: 0 }));
  metas.sort((a, b) => (b.p.t || b.created) - (a.p.t || a.created));
  const cont = $('#continue'); cont.innerHTML = '';
  const last = metas.find(m => m.id === LS.get('sv:last') && m.p.pct > 0 && m.p.pct < 99.5); if (last) cont.append(card(last, true));
  const box = $('#books'); box.innerHTML = ''; metas.forEach(m => box.append(card(m)));
  $('#empty').hidden = metas.length > 0;
}
async function openBook(id) {
  if (P.meta) P.pause();
  let meta, text; try { meta = (await DB.metas()).find(m => m.id === id); text = await DB.text(id); } catch {}
  if (!meta || !text) return toast('This book couldn’t be opened. Try deleting it and adding it again.');
  await P.load(meta, text, LS.get('sv:p:' + id, { i: 0, pct: 0 })); LS.set('sv:last', id); lastSec = lastI = -1;
  $('#bTitle').textContent = meta.title; $('#q').value = ''; $('#results').hidden = true; $('#txt').hidden = false;
  show('book'); renderChapters(); renderMarks(); setTab('listen'); upd(); renderPlay(); renderStatus(); sleepUI(); renderChips();
}

/* ---------- player UI ---------- */
function upd() {
  if (!P.meta) return;
  const s = P.secOf(P.i), sp = P.cps * S.rate;
  $('#chap').textContent = P.secs[s].title; $('#bk').textContent = P.meta.title + (P.meta.author ? ' · ' + P.meta.author : '');
  $('#pct').textContent = Math.round(P.pct()) + '% of the book · chapter ' + (s + 1) + ' of ' + P.secs.length;
  $('#time').textContent = fmt(P.cum[P.i] / sp) + ' / ' + fmt(P.total / sp);
  const sl = $('#seek'); sl.max = P.chunks.length - 1; if (!seeking) sl.value = P.i;
  if (s !== lastSec) { lastSec = s; renderText(); markChapter(); P.updateMedia(); }
  if (P.i !== lastI) {
    lastI = P.i; const prev = $('#txt .cur'); if (prev) prev.classList.remove('cur');
    const c = $(`#txt [data-i="${P.i}"]`); if (c) { c.classList.add('cur'); if (tab === 'text' && !$('#txt').hidden) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
}
function renderPlay() {
  const b = $('#play'), on = P.meta && P.playing;
  b.innerHTML = on ? '<b>❚❚</b><small>Pause</small>' : '<b>▶</b><small>Play</small>'; b.setAttribute('aria-label', on ? 'Pause' : 'Play');
}
function statusText() {
  if (!P.meta) return '';
  if (P.mode === 'basic') return 'Basic device voice. It may stop when the screen turns off. Choose the Natural voice in Settings for background listening.';
  if (engine.state === 'downloading') return `Downloading natural voice… ${engine.mb.toFixed(0)} of ${engine.totalMb ? engine.totalMb.toFixed(0) : '~90'} MB. This happens once.`;
  if (engine.state === 'loading') return 'Loading natural voice…';
  if (engine.state === 'error') return 'The natural voice couldn’t start. Check your connection and press Play to try again.';
  let s = '';
  if (P.prepSec != null) { const ks = P.segs.map((x, k) => k).filter(k => P.segs[k].s === P.prepSec); s += `Preparing this chapter: ${ks.filter(k => P.has(k)).length} of ${ks.length} parts. `; }
  if (P.playing && P.waiting) return s + 'Preparing narration…';
  const a = P.ahead(); if (a > 1) s += `Audio ready ahead: ${fmt(a)}`;
  if (P.rtf) { s += (s ? ' · ' : '') + `voice speed ${P.rtf.toFixed(1)}× real time`; if (P.playing && P.rtf < S.rate * 1.05) s += '. Your device generates audio slower than it plays; try 1× speed or “Prepare this chapter”.'; }
  return s;
}
function renderStatus() { lastStatus = Date.now(); $('#audioStatus').textContent = statusText(); const pb = $('#prepBtn'); if (pb) pb.hidden = P.mode !== 'neural'; $('#prepHint').hidden = P.mode !== 'neural'; }
function renderText() {
  const box = $('#txt'); box.innerHTML = ''; box.style.fontSize = S.size + 'px';
  const s = P.secOf(P.i), a = P.secs[s].start, b = s + 1 < P.secs.length ? P.secs[s + 1].start : P.chunks.length; let p = null;
  for (let k = a; k < b; k++) { // textContent only: PDF text is never inserted as HTML
    const [t, f] = P.chunks[k];
    if (f === 2) { const e = h('h3', null, t); e.dataset.i = k; box.append(e); p = null; continue; }
    if (!p || f === 1) { p = h('p'); box.append(p); }
    const sp = h('span', 'ck', t + ' '); sp.dataset.i = k; p.append(sp);
  }
}
function markChapter() { document.querySelectorAll('#chapList .item').forEach((e, k) => e.classList.toggle('cur2', k === lastSec)); }
function renderChapters() {
  const box = $('#chapList'); box.innerHTML = '';
  P.secs.forEach(s => { const b = h('button', 'item'); b.append(h('div', null, s.title), h('div', 'mut', Math.round(P.cum[s.start] / P.total * 100) + '% into the book · ' + fmt(P.cum[s.start] / P.cps) + ' in')); b.onclick = () => { P.jump(s.start, true); setTab('listen'); }; box.append(b); });
}
function renderMarks() {
  const box = $('#markList'); box.innerHTML = ''; const L = LS.get('sv:b:' + P.meta.id, []);
  if (!L.length) { box.append(h('p', 'muted', 'No bookmarks yet. Tap “Bookmark this spot” on the Listen tab.')); return; }
  L.sort((a, b) => a.i - b.i).forEach(m => {
    const r = h('div', 'mk'), b = h('button', 'item'); b.append(h('div', null, '🔖 ' + m.sec), h('div', 'mut', m.at));
    b.onclick = () => { P.jump(m.i, true); setTab('listen'); };
    const x = h('button', 'btn', 'Remove'); x.setAttribute('aria-label', 'Remove bookmark at ' + m.at);
    x.onclick = () => { LS.set('sv:b:' + P.meta.id, LS.get('sv:b:' + P.meta.id, []).filter(z => z.t !== m.t)); renderMarks(); };
    r.append(b, x); box.append(r);
  });
}
function setTab(t) {
  tab = t; document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  ['listen', 'text', 'chapters', 'marks'].forEach(n => $('#tab-' + n).hidden = n !== t);
  if (t === 'text') { const c = $('#txt .cur'); if (c) c.scrollIntoView({ block: 'center' }); }
  if (t === 'marks') renderMarks();
}
function renderChips() {
  const sp = $('#speeds'); sp.innerHTML = '';
  [0.75, 1, 1.25, 1.5, 1.75, 2].forEach(r => { const b = h('button', null, r + '×'); b.setAttribute('aria-pressed', S.rate === r); b.onclick = () => { P.setRate(r); saveS(); renderChips(); upd(); renderStatus(); }; sp.append(b); });
  const sl = $('#sleeps'); sl.innerHTML = '';
  [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '60 min'], ['sec', 'End of chapter'], [null, 'Off']].forEach(([m, l]) => { const b = h('button', null, l); b.setAttribute('aria-pressed', P.sleep.mode === m); b.onclick = () => { P.setSleep(m); renderChips(); }; sl.append(b); });
}
function sleepUI() { const sl = P.sleep; $('#sleepInfo').textContent = sl.mode === 'sec' ? 'Will pause at the end of this chapter.' : typeof sl.mode === 'number' ? 'Pausing in ' + fmt((sl.end - Date.now()) / 1000) : ''; if (!sl.mode) renderChips(); }
function addMark() { const L = LS.get('sv:b:' + P.meta.id, []), at = fmt(P.cum[P.i] / P.cps); L.push({ i: P.i, sec: P.secs[P.secOf(P.i)].title, at, t: Date.now() }); LS.set('sv:b:' + P.meta.id, L); renderMarks(); toast('Bookmarked at ' + at); }
function doSearch() {
  const q = $('#q').value.trim().toLowerCase(), box = $('#results'); box.innerHTML = ''; box.hidden = !q; $('#txt').hidden = !!q; if (!P.meta || !q) return;
  if (q.length < 2) { box.append(h('p', 'muted', 'Keep typing…')); return; }
  let n = 0;
  for (let k = 0; k < P.chunks.length && n < 50; k++) {
    const t = P.chunks[k][0], x = t.toLowerCase().indexOf(q); if (x < 0) continue; n++;
    const b = h('button', 'res'); b.append(h('span', 'rs', P.secs[P.secOf(k)].title), h('span', null, '…' + t.slice(Math.max(0, x - 40), x + q.length + 60) + '…'));
    b.onclick = () => { $('#q').value = ''; doSearch(); P.jump(k, true); }; box.append(b);
  }
  if (!n) box.append(h('p', 'muted', 'No matches found.'));
}

/* ---------- play / voice setup ---------- */
async function nativePrep() { if (nativeDone) return; nativeDone = true; try { await Promise.race([window.SVNative && window.SVNative.prepare && window.SVNative.prepare(), new Promise(r => setTimeout(r, 1500))]); } catch {} }
async function togglePlay() {
  if (!P.meta) return;
  if (P.playing) return P.pause();
  if (P.mode === 'neural' && !engine.ready && !engine.modelKnown) return openSetup();
  await nativePrep(); P.play();
}
function setupUI() {
  const e = engine, pct = e.totalMb ? Math.min(100, e.mb / e.totalMb * 100) : 0;
  $('#setupBar').style.width = pct + '%';
  $('#setupMsg').textContent = e.state === 'downloading' ? `Downloading… ${e.mb.toFixed(0)} of ${e.totalMb ? e.totalMb.toFixed(0) : '~90'} MB` : e.state === 'loading' ? 'Starting the voice…' : e.state === 'error' ? 'Download failed. Check your connection and try again.' : '';
}
function openSetup() { setupUI(); $('#setupGo').disabled = false; $('#setup').showModal(); }
engine.on(() => { renderStatus(); if ($('#setup').open) setupUI(); });

/* ---------- settings ---------- */
function applyTheme() { S.theme === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.dataset.theme = S.theme; }
function fillVoices() {
  const nv = $('#setNVoice'); if (!nv.options.length) VOICES.forEach(([v, l]) => nv.append(new Option(l, v))); nv.value = S.nvoice;
  if (!('speechSynthesis' in window)) return;
  const sel = $('#setBVoice'), vs = speechSynthesis.getVoices(), lang = (navigator.language || 'en').slice(0, 2);
  sel.innerHTML = ''; sel.append(new Option('Device default', ''));
  [...vs].sort((a, b) => (b.lang.startsWith(lang) - a.lang.startsWith(lang)) || a.name.localeCompare(b.name)).forEach(v => sel.append(new Option(`${v.name} (${v.lang})`, v.voiceURI))); sel.value = S.bvoice;
}
async function openSettings() {
  $('#setQuality').value = S.quality; $('#setTheme').value = S.theme; $('#setSize').value = S.size; $('#sizeVal').textContent = S.size + 'px'; $('#setCap').value = String(S.cap); fillVoices();
  $('#settings').showModal();
  let a = 0; try { a = (await DB.audioIdx()).reduce((x, y) => x + y.size, 0); } catch {}
  let u = ''; try { const e = await navigator.storage.estimate(); u = ` Total storage used: ${(e.usage / 1048576).toFixed(0)} MB.`; } catch {}
  $('#storeInfo').textContent = `Generated audio: ${(a / 1048576).toFixed(0)} MB. Natural voice: ${engine.modelKnown ? 'downloaded' : 'not downloaded yet'}.${u}`;
}
function bind() {
  $('#file').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); if (!$('#library').hidden) importFile(e.dataTransfer.files[0]); });
  document.querySelectorAll('.openSettings').forEach(b => b.onclick = openSettings);
  $('#closeSettings').onclick = () => $('#settings').close();
  $('#setTheme').onchange = e => { S.theme = e.target.value; saveS(); applyTheme(); };
  $('#setQuality').onchange = e => { if (P.meta) P.pause(); S.quality = e.target.value; saveS(); renderStatus(); renderPlay(); };
  $('#setNVoice').onchange = async e => { S.nvoice = e.target.value; saveS(); if (P.meta) await P.reloadVoice(); };
  $('#setBVoice').onchange = e => { S.bvoice = e.target.value; saveS(); if (P.playing && P.mode === 'basic') P.speak(); };
  $('#setCap').onchange = e => { S.cap = +e.target.value; saveS(); };
  $('#setSize').oninput = e => { S.size = +e.target.value; saveS(); $('#sizeVal').textContent = S.size + 'px'; $('#txt').style.fontSize = S.size + 'px'; };
  $('#clearAudio').onclick = async () => { if (P.meta) P.pause(); await P.clearAudio(); toast('Generated audio cleared.'); openSettings(); };
  $('#removeModel').onclick = async () => { if (!confirm('Remove the downloaded voice model? It will need to be downloaded again (about 90 MB) before the Natural voice can be used.')) return; if (P.meta) P.pause(); await engine.removeModel(); toast('Voice model removed.'); openSettings(); };
  $('#clearAll').onclick = async () => {
    if (!confirm('Delete every book, bookmark, progress record and generated audio from this device?')) return;
    P.unload(); await DB.clear().catch(() => {});
    Object.keys(localStorage).filter(k => /^sv:(p|b|last)/.test(k)).forEach(k => LS.del(k));
    $('#settings').close(); show('library'); renderLibrary(); toast('All local data deleted.');
  };
  $('#setupGo').onclick = async () => { $('#setupGo').disabled = true; const ok = await engine.ensure(); if (ok) { $('#setup').close(); await nativePrep(); P.play(); } else { setupUI(); $('#setupGo').disabled = false; } };
  $('#setupBasic').onclick = () => { S.quality = 'basic'; saveS(); $('#setup').close(); renderStatus(); P.play(); };
  $('#setupCancel').onclick = () => $('#setup').close();
  $('#back').onclick = () => { P.pause(); show('library'); renderLibrary(); };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('#play').onclick = togglePlay;
  $('#back15').onclick = () => P.meta && P.seek(-15); $('#fwd30').onclick = () => P.meta && P.seek(30);
  $('#prev').onclick = () => P.meta && P.prevSec(); $('#next').onclick = () => P.meta && P.nextSec();
  const sl = $('#seek');
  sl.addEventListener('input', () => { seeking = true; if (P.meta) $('#time').textContent = fmt(P.cum[+sl.value] / (P.cps * S.rate)) + ' / ' + fmt(P.total / (P.cps * S.rate)); });
  sl.addEventListener('change', () => { seeking = false; if (P.meta) P.jump(+sl.value); });
  $('#markBtn').onclick = () => P.meta && addMark();
  $('#prepBtn').onclick = async () => { if (!P.meta) return; if (!engine.ready && !engine.modelKnown) return openSetup(); P.prepare(); toast('Preparing this chapter’s audio. You can keep this screen open or come back later.'); };
  $('#restartBtn').onclick = () => { if (P.meta && confirm('Restart this book from the beginning?')) { P.pause(); P.jump(0, true); } };
  $('#txt').onclick = e => { const c = e.target.closest('[data-i]'); if (c && P.meta) P.jump(+c.dataset.i, true); };
  let sT; $('#q').addEventListener('input', () => { clearTimeout(sT); sT = setTimeout(doSearch, 250); });
  document.addEventListener('keydown', e => {
    if (!P.meta || $('#book').hidden || e.target !== document.body) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); } else if (e.key === 'ArrowLeft') P.seek(-15); else if (e.key === 'ArrowRight') P.seek(30);
  });
  document.addEventListener('visibilitychange', () => {
    if (P.meta) P.save();
    if (document.visibilityState === 'visible' && P.meta && P.playing) { if (P.mode === 'basic') { P.wake(); if (!speechSynthesis.speaking && !speechSynthesis.pending) P.speak(); } renderStatus(); upd(); }
  });
  window.addEventListener('pagehide', () => P.meta && P.save());
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fillVoices;
}
(function init() {
  applyTheme(); bind(); renderChips();
  if (!('indexedDB' in window)) toast('This browser can’t store books locally, so SanaVerse won’t work here.');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  renderLibrary();
})();
