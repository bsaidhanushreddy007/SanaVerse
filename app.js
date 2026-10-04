'use strict';
/* SanaVerse – PDF → text → cleaned chunks → browser speech. Everything runs on-device. */
const CPS = 15;            // estimated spoken characters per second at 1x (for time estimates and seeking)
const MAXC = 260;          // max characters per speech chunk (keeps browser TTS reliable)
const PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
class AppError extends Error {}

/* ---------- small helpers ---------- */
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 4500); }
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Browser storage is full, so progress may not be saved.'); } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const S = Object.assign({ theme: 'auto', rate: 1, voice: '', size: 19 }, LS.get('sv:settings', {}));
const saveS = () => LS.set('sv:settings', S);
const p2 = n => String(n).padStart(2, '0');
function fmt(s) { s = Math.max(0, Math.round(s)); const H = Math.floor(s / 3600), M = Math.floor(s % 3600 / 60), c = s % 60; return H ? `${H}:${p2(M)}:${p2(c)}` : `${M}:${p2(c)}`; }
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---------- IndexedDB (extracted text lives here, on the device) ---------- */
const DB = {
  open() { return this.p || (this.p = new Promise((ok, no) => { const r = indexedDB.open('sanaverse', 1); r.onupgradeneeded = () => { r.result.createObjectStore('meta', { keyPath: 'id' }); r.result.createObjectStore('text', { keyPath: 'id' }); }; r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); })); },
  async run(names, mode, fn) { const db = await this.open(); return new Promise((ok, no) => { const t = db.transaction(names, mode); const out = fn(...names.map(n => t.objectStore(n))); t.oncomplete = () => ok(out && 'result' in out ? out.result : undefined); t.onerror = t.onabort = () => no(t.error); }); },
  metas() { return this.run(['meta'], 'readonly', m => m.getAll()); },
  text(id) { return this.run(['text'], 'readonly', t => t.get(id)); },
  put(meta, text) { return this.run(['meta', 'text'], 'readwrite', (m, t) => { m.put(meta); t.put(text); }); },
  del(id) { return this.run(['meta', 'text'], 'readwrite', (m, t) => { m.delete(id); t.delete(id); }); },
  clear() { return this.run(['meta', 'text'], 'readwrite', (m, t) => { m.clear(); t.clear(); }); }
};

/* ---------- PDF text extraction & cleanup ---------- */
const CH = /^(chapter|part|book|section)\s+(\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
const FRONT = /^(prologue|epilogue|preface|foreword|introduction|conclusion|afterword|appendix|acknowledg(e)?ments)\.?$/i;
const isChap = t => t.length < 80 && /^[A-Z0-9]/.test(t) && (CH.test(t) || FRONT.test(t));
const PGNUM = /^\s*(page\s+)?(\d{1,4}|[ivxlc]{1,6})\s*(of\s+\d+)?\s*$/i;
const LIG = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

function clean(s) {
  return s.replace(/[ﬁﬂﬀﬃﬄﬅﬆ]/g, c => LIG[c]).replace(/\u00AD/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}
function pageLines(tc) {
  const lines = []; let cur = null, prevEnd = 0;
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue;
    const x = it.transform[4], y = it.transform[5], ht = Math.abs(it.height) || Math.abs(it.transform[3]) || 10;
    if (!it.str.trim()) { if (it.hasEOL) cur = null; else if (cur && !cur.t.endsWith(' ')) cur.t += ' '; continue; }
    if (!cur || Math.abs(y - cur.y) > ht * 0.5) { cur = { t: '', y, h: ht }; lines.push(cur); prevEnd = x; }
    else if (x - prevEnd > ht * 0.2 && !cur.t.endsWith(' ') && !it.str.startsWith(' ')) cur.t += ' ';
    cur.t += it.str; cur.h = Math.max(cur.h, ht); prevEnd = x + it.width;
    if (it.hasEOL) cur = null;
  }
  return lines.map(l => ({ ...l, t: clean(l.t) })).filter(l => l.t);
}
const join = (a, b) => (/[a-z]-$/.test(a) && /^[a-z]/.test(b)) ? a.slice(0, -1) + b : a + ' ' + b;

function buildBlocks(pages) {
  const n = pages.length;
  if (n >= 4) { // drop repeated running headers/footers and page numbers (only at page edges)
    const key = t => t.toLowerCase().replace(/\d+/g, '#'), cnt = {}, lim = Math.max(3, n * 0.25);
    const edges = p => [...p.slice(0, 2), ...p.slice(-2)];
    pages.forEach(p => new Set(edges(p).map(l => key(l.t))).forEach(k => cnt[k] = (cnt[k] || 0) + 1));
    pages = pages.map(p => p.filter((l, i) => {
      const e = i < 2 || i >= p.length - 2; if (!e) return true;
      if (PGNUM.test(l.t)) return false;
      const c = cnt[key(l.t)] || 0;
      return !(c >= lim && (!isChap(l.t) || c >= n * 0.5));
    }));
  }
  const hs = pages.flat().map(l => l.h).sort((a, b) => a - b), med = hs[hs.length >> 1] || 10;
  const blocks = [];
  for (const p of pages) {
    let prev = null, para = null;
    for (const l of p) {
      const big = l.h > med * 1.4, mid = l.h > med * 1.2, short = l.t.length < 100;
      const lvl = (isChap(l.t) || (big && short)) ? 2
        : ((mid && short) || (l.t.length < 60 && /[A-Z]{4}/.test(l.t) && l.t === l.t.toUpperCase() && !/[.,;:]$/.test(l.t))) ? 1 : 0;
      if (!prev && blocks.length) { // paragraph continuing from previous page
        const b = blocks[blocks.length - 1];
        if (!b.head && !lvl && !/[.!?:"”’)\]…]$/.test(b.t) && /^[a-z]/.test(l.t)) para = b;
      }
      const gap = prev ? prev.y - l.y : 0;
      const cont = para && ((!lvl && !para.head && gap <= l.h * 1.7) ||
        (lvl && para.head === lvl && Math.abs(para.h - l.h) < 0.5 && !isChap(para.t) && gap <= l.h * 1.7));
      if (cont) para.t = join(para.t, l.t); else { para = { t: l.t, head: lvl, h: l.h }; blocks.push(para); }
      prev = l;
    }
  }
  const out = [];
  for (const b of blocks) {
    const p = out[out.length - 1];
    if (p && p.t === b.t) continue; // exact duplicate
    if (p && p.head && b.head && isChap(p.t) && !isChap(b.t) && p.t.length < 22 && !p.merged) { p.t = p.t.replace(/[.:]$/, '') + ': ' + b.t; p.merged = true; continue; }
    out.push(b);
  }
  return out;
}
function splitText(t) {
  const s = t.match(/[^.!?…]+(?:[.!?…]+["”’')\]]*\s*|$)/g) || [t], out = []; let cur = '';
  for (let x of s) {
    x = x.trim(); if (!x) continue;
    while (x.length > MAXC + 40) {
      let k = x.lastIndexOf(', ', MAXC); if (k < 80) k = x.lastIndexOf(' ', MAXC); if (k < 1) k = MAXC;
      const part = x.slice(0, k + 1).trim(); x = x.slice(k + 1).trim();
      if (cur) { out.push(cur); cur = ''; } out.push(part);
    }
    if (cur && cur.length + x.length + 1 > MAXC) { out.push(cur); cur = x; } else cur = cur ? cur + ' ' + x : x;
  }
  if (cur) out.push(cur); return out;
}
function structure(blocks) { // → chunks [[text, flag]] flag: 0 continuation, 1 new paragraph, 2 heading; secs [{title,start}]
  const c2 = blocks.filter(b => b.head === 2).length, c1 = blocks.filter(b => b.head >= 1).length;
  const thr = c2 >= 2 ? 2 : (c1 >= 3 ? 1 : 9);
  const chunks = [], secs = []; let secChars = 0;
  const startSec = t => { secs.push({ title: t, start: chunks.length }); secChars = 0; };
  for (const b of blocks) {
    if (b.head >= thr) { startSec(b.t.slice(0, 90)); chunks.push([b.t, 2]); continue; }
    if (!secs.length) startSec(thr === 9 ? 'Section 1' : 'Opening');
    if (thr === 9 && secChars > 8000) startSec('Section ' + (secs.length + 1));
    let first = 1; for (const c of splitText(b.t)) { chunks.push([c, first]); first = 0; secChars += c.length; }
  }
  return { chunks, secs };
}

/* ---------- import ---------- */
function busy(on, msg, pct) { $('#busy').hidden = !on; if (msg) $('#busyMsg').textContent = msg; $('#busyBar').style.width = (pct || 0) + '%'; }
const tick = () => new Promise(r => setTimeout(r, 0));
async function importFile(file) {
  if (!file) return;
  if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) return toast('That doesn’t look like a PDF. Please choose a .pdf file.');
  if (!file.size) return toast('That file is empty.');
  if (file.size > 300 * 1024 * 1024) return toast('That PDF is very large (over 300 MB). Please try a smaller file.');
  busy(true, 'Reading your book…', 2);
  try {
    if (!window.pdfjsLib) throw new AppError('The PDF reader could not load. Connect to the internet once, then try again.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_CDN + 'pdf.worker.min.js';
    let pdf; const buf = await file.arrayBuffer();
    try { pdf = await pdfjsLib.getDocument({ data: buf }).promise; }
    catch (e) { throw new AppError(e && e.name === 'PasswordException' ? 'This PDF is password-protected. Remove the password and try again.' : 'This file couldn’t be opened. It may be damaged or not a real PDF.'); }
    const info = await pdf.getMetadata().then(m => m.info || {}).catch(() => ({}));
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const pg = await pdf.getPage(n); pages.push(pageLines(await pg.getTextContent())); pg.cleanup();
      if (n % 5 === 0 || n === pdf.numPages) { busy(true, `Extracting text… page ${n} of ${pdf.numPages}`, 5 + 80 * n / pdf.numPages); await tick(); }
    }
    busy(true, 'Preparing chapters…', 92); await tick();
    const blocks = buildBlocks(pages), chars = blocks.reduce((a, b) => a + b.t.length, 0);
    if (chars < 200 || chars < pdf.numPages * 25) throw new AppError('This PDF doesn’t contain selectable text (it looks like scanned images), so SanaVerse can’t read it aloud. Try a text-based PDF, or run it through an OCR tool first.');
    const { chunks, secs } = structure(blocks);
    const base = file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
    const meta = { id: uid(), title: clean(info.Title || '') || base || 'Untitled book', author: clean(info.Author || ''), pages: pdf.numPages, chars, created: Date.now() };
    await DB.put(meta, { id: meta.id, chunks, secs });
    navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {});
    busy(true, 'Ready to listen.', 100); await tick();
    busy(false); await openBook(meta.id);
  } catch (e) {
    busy(false);
    toast(e instanceof AppError ? e.message : (e && e.name === 'QuotaExceededError') ? 'Not enough storage space on this device for this book.' : 'Something went wrong reading this PDF. It may be damaged or unusual.');
    console.error(e);
  }
}

/* ---------- library ---------- */
function show(v) { $('#library').hidden = v !== 'library'; $('#book').hidden = v !== 'book'; document.body.classList.toggle('inbook', v === 'book'); window.scrollTo(0, 0); }
function card(m, feat) {
  const d = h('article', 'card' + (feat ? ' feat' : '')), pc = m.p.pct || 0;
  if (feat) d.append(h('div', 'lbl', 'Continue Reading'));
  d.append(h('h3', 'bt', m.title));
  if (m.author) d.append(h('div', 'muted', m.author));
  if (m.p.sec && pc > 0) d.append(h('div', 'muted', m.p.sec));
  const bar = h('div', 'bar'), f = h('i'); f.style.width = pc + '%'; bar.append(f);
  bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuenow', Math.round(pc)); d.append(bar);
  d.append(h('div', 'muted small', Math.round(pc) + '% listened' + (pc >= 99.5 ? ' · Finished' : '') + ` · ${m.pages} pages`));
  const row = h('div', 'row');
  const go = h('button', 'btn primary', pc >= 99.5 ? 'Listen again' : pc > 0 ? 'Continue' : 'Start listening'); go.onclick = () => openBook(m.id); row.append(go);
  if (!feat) {
    const rs = h('button', 'btn', 'Restart'); rs.onclick = () => { LS.set('sv:p:' + m.id, { i: 0, pct: 0, t: Date.now() }); renderLibrary(); };
    const dl = h('button', 'btn danger', 'Delete'); dl.onclick = async () => { if (!confirm(`Delete “${m.title}” from this device?`)) return; await DB.del(m.id).catch(() => {}); ['p', 'b'].forEach(k => LS.del(`sv:${k}:${m.id}`)); renderLibrary(); };
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
  const last = metas.find(m => m.id === LS.get('sv:last') && m.p.pct > 0 && m.p.pct < 99.5);
  if (last) cont.append(card(last, true));
  const box = $('#books'); box.innerHTML = ''; metas.forEach(m => box.append(card(m)));
  $('#empty').hidden = metas.length > 0;
}

/* ---------- player ---------- */
let P = null, seeking = false, tab = 'listen';
const secOf = i => { let lo = 0, hi = P.secs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (P.secs[m].start <= i) lo = m; else hi = m - 1; } return lo; };
async function openBook(id) {
  if (P) pause();
  let meta, text;
  try { meta = (await DB.metas()).find(m => m.id === id); text = await DB.text(id); } catch {}
  if (!meta || !text) return toast('This book couldn’t be opened. Try deleting it and adding it again.');
  const cum = new Float64Array(text.chunks.length + 1); text.chunks.forEach((c, k) => cum[k + 1] = cum[k] + c[0].length);
  const sv = LS.get('sv:p:' + id, { i: 0, pct: 0 });
  P = { id, meta, chunks: text.chunks, secs: text.secs, cum, total: cum[cum.length - 1] || 1, i: sv.pct >= 99.5 ? 0 : Math.min(sv.i || 0, text.chunks.length - 1), playing: false, tok: 0, fails: 0, sec: -1, done: false };
  LS.set('sv:last', id); setSleep(null);
  $('#bTitle').textContent = meta.title; $('#q').value = ''; $('#results').hidden = true; $('#txt').hidden = false;
  show('book'); renderChapters(); renderMarks(); setTab('listen'); upd(); setMedia();
}
function save(pct) { if (!P) return; LS.set('sv:p:' + P.id, { i: P.i, pct: pct != null ? pct : P.cum[P.i] / P.total * 100, sec: P.secs[secOf(P.i)].title, t: Date.now() }); }
function upd() {
  if (!P) return;
  const s = secOf(P.i), sp = CPS * S.rate;
  $('#chap').textContent = P.secs[s].title; $('#bk').textContent = P.meta.title + (P.meta.author ? ' · ' + P.meta.author : '');
  $('#pct').textContent = Math.round(P.cum[P.i] / P.total * 100) + '% of the book · chapter ' + (s + 1) + ' of ' + P.secs.length;
  $('#time').textContent = fmt(P.cum[P.i] / sp) + ' / ' + fmt(P.total / sp);
  const sl = $('#seek'); sl.max = P.chunks.length - 1; if (!seeking) sl.value = P.i;
  if (s !== P.sec) { P.sec = s; renderText(); $$chapters(); }
  const prevC = $('#txt .cur'); if (prevC) prevC.classList.remove('cur');
  const c = $(`#txt [data-i="${P.i}"]`); if (c) { c.classList.add('cur'); if (tab === 'text' && !$('#txt').hidden) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}
function ui() {
  const b = $('#play'); b.innerHTML = P && P.playing ? '<b>❚❚</b><small>Pause</small>' : '<b>▶</b><small>Play</small>';
  b.setAttribute('aria-label', P && P.playing ? 'Pause' : 'Play');
  if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = P && P.playing ? 'playing' : 'paused'; } catch {}
}
function renderText() {
  const box = $('#txt'); box.innerHTML = ''; box.style.fontSize = S.size + 'px';
  const s = secOf(P.i), a = P.secs[s].start, b = s + 1 < P.secs.length ? P.secs[s + 1].start : P.chunks.length; let p = null;
  for (let k = a; k < b; k++) {
    const [t, f] = P.chunks[k];
    if (f === 2) { const e = h('h3', null, t); e.dataset.i = k; box.append(e); p = null; continue; }
    if (!p || f === 1) { p = h('p'); box.append(p); }
    const sp = h('span', 'ck', t + ' '); sp.dataset.i = k; p.append(sp);
  }
}
function $$chapters() { document.querySelectorAll('#chapList .item').forEach((e, k) => e.classList.toggle('cur2', k === P.sec)); }
function renderChapters() {
  const box = $('#chapList'); box.innerHTML = '';
  P.secs.forEach((s, k) => { const b = h('button', 'item'); b.append(h('div', null, s.title), h('div', 'mut', Math.round(P.cum[s.start] / P.total * 100) + '% into the book · ' + fmt(P.cum[s.start] / CPS) + ' at 1×')); b.onclick = () => { jump(s.start, true); setTab('listen'); }; box.append(b); });
}
function renderMarks() {
  const box = $('#markList'); box.innerHTML = ''; const L = LS.get('sv:b:' + P.id, []);
  if (!L.length) { box.append(h('p', 'muted', 'No bookmarks yet. Tap “Bookmark this spot” on the Listen tab.')); return; }
  L.sort((a, b) => a.i - b.i).forEach(m => {
    const r = h('div', 'mk'), b = h('button', 'item'); b.append(h('div', null, '🔖 ' + m.sec), h('div', 'mut', m.at + ' (at 1× speed)'));
    b.onclick = () => { jump(m.i, true); setTab('listen'); };
    const x = h('button', 'btn', 'Remove'); x.setAttribute('aria-label', 'Remove bookmark at ' + m.at);
    x.onclick = () => { LS.set('sv:b:' + P.id, LS.get('sv:b:' + P.id, []).filter(z => z.t !== m.t)); renderMarks(); };
    r.append(b, x); box.append(r);
  });
}
function setTab(t) {
  tab = t; document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  ['listen', 'text', 'chapters', 'marks'].forEach(n => $('#tab-' + n).hidden = n !== t);
  if (t === 'text') { const c = $('#txt .cur'); if (c) c.scrollIntoView({ block: 'center' }); }
  if (t === 'marks') renderMarks();
}

/* ---------- speech ---------- */
let wl = null;
async function wake() { try { if ('wakeLock' in navigator && !wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => wl = null); } } catch {} }
function unwake() { try { wl && wl.release(); } catch {} wl = null; }
function speak() {
  if (!P || !P.playing) return;
  const tts = window.speechSynthesis, tok = ++P.tok; clearTimeout(P.wd);
  const [t, f] = P.chunks[P.i], u = new SpeechSynthesisUtterance(f === 2 ? t + '.' : t); u.rate = S.rate;
  const v = S.voice && tts.getVoices().find(x => x.voiceURI === S.voice); if (v) { u.voice = v; u.lang = v.lang; }
  let started = false;
  u.onstart = () => { started = true; P.fails = 0; clearTimeout(P.wd); };
  u.onend = () => { if (tok === P.tok) { clearTimeout(P.wd); advance(); } };
  u.onerror = e => { if (tok !== P.tok || e.error === 'canceled' || e.error === 'interrupted') return; retry(); };
  P.u = u; // keep a reference (some browsers drop events for garbage-collected utterances)
  const need = tts.speaking || tts.pending; if (need) tts.cancel();
  const go = () => { if (tok === P.tok && P.playing) tts.speak(u); };
  need ? setTimeout(go, 60) : go();
  P.wd = setTimeout(() => { if (!started && tok === P.tok) retry(); }, 7000);
}
function retry() {
  if (++P.fails <= 2) return setTimeout(speak, 300);
  pause(); toast('Speech stopped. Check your device’s voice settings (or pick another voice in Settings), then press Play.');
}
function advance() {
  const old = secOf(P.i);
  if (P.i >= P.chunks.length - 1) { P.playing = false; P.done = true; unwake(); ui(); save(100); upd(); toast('You’ve reached the end of the book.'); return; }
  P.i++; upd(); save();
  if (sleep.mode === 'sec' && secOf(P.i) !== old) { pause(); setSleep(null); toast('Sleep timer: paused at the end of the chapter.'); return; }
  speak();
}
function play() {
  if (!P) return;
  if (!('speechSynthesis' in window)) return toast('Your browser can’t read aloud. Try Chrome, Edge, Safari or Firefox.');
  if (P.done) { P.i = 0; P.done = false; upd(); }
  P.playing = true; P.fails = 0; wake(); ui(); speak();
}
function pause() { if (!P) return; P.playing = false; P.tok++; clearTimeout(P.wd); try { speechSynthesis.cancel(); } catch {} unwake(); ui(); save(); }
function jump(k, go) { P.i = Math.max(0, Math.min(P.chunks.length - 1, k)); P.done = false; P.fails = 0; upd(); save(); if (go || P.playing) play(); }
function seek(sec) {
  let need = Math.abs(sec) * CPS * S.rate, j = P.i;
  if (sec < 0) { while (j > 0 && need > 0) { j--; need -= P.chunks[j][0].length; } }
  else { while (j < P.chunks.length - 1 && need > 0) { need -= P.chunks[j][0].length; j++; } }
  jump(j);
}
function prevSec() { const s = secOf(P.i); jump(P.i - P.secs[s].start > 3 || s === 0 ? P.secs[s].start : P.secs[s - 1].start); }
function nextSec() { const s = secOf(P.i); if (s + 1 < P.secs.length) jump(P.secs[s + 1].start); }
function setMedia() {
  if (!('mediaSession' in navigator) || !P) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: P.meta.title, artist: P.meta.author || 'SanaVerse' });
    const a = (n, f) => navigator.mediaSession.setActionHandler(n, f);
    a('play', play); a('pause', () => pause()); a('previoustrack', prevSec); a('nexttrack', nextSec); a('seekbackward', () => seek(-15)); a('seekforward', () => seek(30));
  } catch {}
}

/* ---------- speed, sleep, bookmarks, search ---------- */
const sleep = { mode: null, end: 0, iv: null };
function renderChips() {
  const sp = $('#speeds'); sp.innerHTML = '';
  [0.75, 1, 1.25, 1.5, 1.75, 2].forEach(r => { const b = h('button', null, r + '×'); b.setAttribute('aria-pressed', S.rate === r); b.onclick = () => { S.rate = r; saveS(); renderChips(); upd(); if (P && P.playing) speak(); }; sp.append(b); });
  const sl = $('#sleeps'); sl.innerHTML = '';
  [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '60 min'], ['sec', 'End of chapter'], [null, 'Off']].forEach(([m, l]) => { const b = h('button', null, l); b.setAttribute('aria-pressed', sleep.mode === m); b.onclick = () => setSleep(m); sl.append(b); });
}
function setSleep(m) {
  clearInterval(sleep.iv); sleep.iv = null; sleep.mode = m;
  if (typeof m === 'number') { sleep.end = Date.now() + m * 60000; sleep.iv = setInterval(() => { if (sleep.end - Date.now() <= 0) { setSleep(null); pause(); toast('Sleep timer finished.'); } else sleepUI(); }, 1000); }
  renderChips(); sleepUI();
}
function sleepUI() { $('#sleepInfo').textContent = sleep.mode === 'sec' ? 'Will pause at the end of this chapter.' : typeof sleep.mode === 'number' ? 'Pausing in ' + fmt((sleep.end - Date.now()) / 1000) : ''; }
function addMark() { const L = LS.get('sv:b:' + P.id, []); const at = fmt(P.cum[P.i] / CPS); L.push({ i: P.i, sec: P.secs[secOf(P.i)].title, at, t: Date.now() }); LS.set('sv:b:' + P.id, L); renderMarks(); toast('Bookmarked at ' + at); }
function doSearch() {
  const q = $('#q').value.trim().toLowerCase(), box = $('#results'); box.innerHTML = '';
  box.hidden = !q; $('#txt').hidden = !!q; if (!P || !q) return;
  if (q.length < 2) { box.append(h('p', 'muted', 'Keep typing…')); return; }
  let n = 0;
  for (let k = 0; k < P.chunks.length && n < 50; k++) {
    const t = P.chunks[k][0], x = t.toLowerCase().indexOf(q); if (x < 0) continue; n++;
    const b = h('button', 'res'); b.append(h('span', 'rs', P.secs[secOf(k)].title), h('span', null, '…' + t.slice(Math.max(0, x - 40), x + q.length + 60) + '…'));
    b.onclick = () => { $('#q').value = ''; doSearch(); jump(k, true); }; box.append(b);
  }
  if (!n) box.append(h('p', 'muted', 'No matches found.'));
}

/* ---------- settings ---------- */
function applyTheme() { S.theme === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.dataset.theme = S.theme; }
function fillVoices() {
  if (!('speechSynthesis' in window)) return;
  const sel = $('#setVoice'), vs = speechSynthesis.getVoices(), lang = (navigator.language || 'en').slice(0, 2);
  sel.innerHTML = ''; sel.append(new Option('Device default', ''));
  [...vs].sort((a, b) => (b.lang.startsWith(lang) - a.lang.startsWith(lang)) || a.name.localeCompare(b.name)).forEach(v => sel.append(new Option(`${v.name} (${v.lang})`, v.voiceURI)));
  sel.value = S.voice;
}
async function openSettings() {
  $('#setTheme').value = S.theme; $('#setSize').value = S.size; $('#sizeVal').textContent = S.size + 'px'; fillVoices();
  try { const e = await navigator.storage.estimate(); $('#storeInfo').textContent = `Storage used by SanaVerse: ${(e.usage / 1048576).toFixed(1)} MB. Books are stored as text on this device only.`; } catch { $('#storeInfo').textContent = 'Books are stored as text on this device only.'; }
  $('#settings').showModal();
}

/* ---------- wiring ---------- */
function bind() {
  $('#file').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); if (!$('#library').hidden) importFile(e.dataTransfer.files[0]); });
  document.querySelectorAll('.openSettings').forEach(b => b.onclick = openSettings);
  $('#closeSettings').onclick = () => $('#settings').close();
  $('#setTheme').onchange = e => { S.theme = e.target.value; saveS(); applyTheme(); };
  $('#setVoice').onchange = e => { S.voice = e.target.value; saveS(); if (P && P.playing) speak(); };
  $('#setSize').oninput = e => { S.size = +e.target.value; saveS(); $('#sizeVal').textContent = S.size + 'px'; $('#txt').style.fontSize = S.size + 'px'; };
  $('#clearAll').onclick = async () => {
    if (!confirm('Delete every book, bookmark and progress record from this device?')) return;
    if (P) pause(); P = null; await DB.clear().catch(() => {});
    Object.keys(localStorage).filter(k => /^sv:(p|b|last)/.test(k)).forEach(k => LS.del(k));
    $('#settings').close(); show('library'); renderLibrary(); toast('All local data deleted.');
  };
  $('#back').onclick = () => { if (P) { pause(); } show('library'); renderLibrary(); };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('#play').onclick = () => P && (P.playing ? pause() : play());
  $('#back15').onclick = () => P && seek(-15); $('#fwd30').onclick = () => P && seek(30);
  $('#prev').onclick = () => P && prevSec(); $('#next').onclick = () => P && nextSec();
  const sl = $('#seek');
  sl.addEventListener('input', () => { seeking = true; if (P) $('#time').textContent = fmt(P.cum[+sl.value] / (CPS * S.rate)) + ' / ' + fmt(P.total / (CPS * S.rate)); });
  sl.addEventListener('change', () => { seeking = false; if (P) jump(+sl.value); });
  $('#markBtn').onclick = () => P && addMark();
  $('#restartBtn').onclick = () => { if (P && confirm('Restart this book from the beginning?')) { pause(); jump(0, true); } };
  $('#txt').onclick = e => { const c = e.target.closest('[data-i]'); if (c && P) jump(+c.dataset.i, true); };
  let sT; $('#q').addEventListener('input', () => { clearTimeout(sT); sT = setTimeout(doSearch, 250); });
  document.addEventListener('keydown', e => {
    if (!P || $('#book').hidden || e.target !== document.body) return;
    if (e.code === 'Space') { e.preventDefault(); P.playing ? pause() : play(); }
    else if (e.key === 'ArrowLeft') seek(-15); else if (e.key === 'ArrowRight') seek(30);
  });
  document.addEventListener('visibilitychange', () => {
    if (P) save();
    if (document.visibilityState === 'visible' && P && P.playing) { wake(); if (!speechSynthesis.speaking && !speechSynthesis.pending) speak(); }
  });
  window.addEventListener('pagehide', () => P && save());
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fillVoices;
}
(function init() {
  applyTheme(); bind(); renderChips();
  if (!('speechSynthesis' in window)) $('#nospeech').hidden = false;
  if (!('indexedDB' in window)) toast('This browser can’t store books locally, so SanaVerse won’t work here.');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  renderLibrary();
})();
