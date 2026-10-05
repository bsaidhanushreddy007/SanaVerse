/* SanaVerse – audiobook player. Neural mode: narration is generated per ~1-minute segment, cached on-device, and played through a real
   <audio> element + Media Session (lock-screen controls, background playback). Basic mode: device speech synthesis (fallback). */
import { DB, LS, S } from './storage.js';
import { engine, encodeWav, SR, silenceUrl } from './tts.js';
import { prepSpeech } from './extract.js';

export const SEG_CHARS = 700, AHEAD = 3, AV = 1; // AV = audio cache version (bump if narration prep changes)
const p2 = n => String(n).padStart(2, '0');
export function fmt(s) { s = Math.max(0, Math.round(s)); const H = Math.floor(s / 3600), M = Math.floor(s % 3600 / 60), c = s % 60; return H ? `${H}:${p2(M)}:${p2(c)}` : `${M}:${p2(c)}`; }
const concat = (parts, n) => { const o = new Float32Array(n); let p = 0; for (const a of parts) { o.set(a, p); p += a.length; } return o; };

export function makeSegs(chunks, secs) { // consecutive chunks grouped into ~1 minute of speech; never crossing a chapter boundary
  const segs = [];
  secs.forEach((s, k) => {
    const end = k + 1 < secs.length ? secs[k + 1].start : chunks.length; let a = s.start, n = 0;
    for (let i = s.start; i < end; i++) {
      n += chunks[i][0].length;
      if (n >= SEG_CHARS || i === end - 1) {
        if (i === end - 1 && n < 250 && segs.length && segs[segs.length - 1].s === k) segs[segs.length - 1].b = i + 1; else segs.push({ a, b: i + 1, s: k });
        a = i + 1; n = 0;
      }
    }
  });
  return segs;
}

export class Player {
  constructor(ui) {
    this.ui = ui; this.au = document.getElementById('au'); this.mem = new Map(); this.cached = new Set(); this.durs = new Map();
    this.cps = LS.get('sv:cps', 15); this.sleep = { mode: null, end: 0, iv: null }; this.ptok = 0; this.btok = 0; this.lastSave = 0;
    const au = this.au;
    au.addEventListener('timeupdate', () => this.onTime());
    au.addEventListener('ended', () => this.onEnded());
    au.addEventListener('error', () => this.onAudioError());
    au.addEventListener('pause', () => { if (this.playing && !this.waiting && this.mode === 'neural' && this.curData && !au.ended && !au.loop && !au.seeking) this.pause(); }); // paused by the OS / headset / a call
  }
  get mode() { return S.quality === 'basic' || !engine.supported ? 'basic' : 'neural'; }

  /* ----- load / geometry ----- */
  async load(meta, text, saved) {
    this.unload(); this.meta = meta; this.chunks = text.chunks; this.secs = text.secs; this.segs = makeSegs(text.chunks, text.secs);
    const cum = new Float64Array(this.chunks.length + 1); this.chunks.forEach((c, k) => cum[k + 1] = cum[k] + c[0].length);
    this.cum = cum; this.total = cum[cum.length - 1] || 1;
    this.i = Math.max(0, Math.min(saved.pct >= 99.5 ? 0 : (saved.i || 0), this.chunks.length - 1)); this.o = saved.pct >= 99.5 ? 0 : (saved.o || 0);
    this.cur = this.segOf(this.i); this.playing = false; this.waiting = false; this.done = false; this.prepSec = null; this.curData = null; this.fails = 0;
    await this.loadIndex(); this.bindMedia(); this.updateMedia();
  }
  async loadIndex() {
    this.cached.clear(); this.durs.clear();
    try { (await DB.audioIdx()).forEach(x => { if (x.bookId === this.meta.id && x.voice === S.nvoice && x.v === AV) { this.cached.add(x.k); this.durs.set(x.k, x.dur); } }); } catch {}
  }
  unload() {
    if (this.meta) this.pause(); this.setSleep(null);
    for (const d of this.mem.values()) URL.revokeObjectURL(d.url); this.mem.clear(); this.curData = null; this.meta = null;
  }
  secOf(i) { let lo = 0, hi = this.secs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.secs[m].start <= i) lo = m; else hi = m - 1; } return lo; }
  segOf(i) { let lo = 0, hi = this.segs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.segs[m].a <= i) lo = m; else hi = m - 1; } return lo; }
  setI(i) { this.i = i; this.cur = this.segOf(i); }
  pct() { return this.cum[this.i] / this.total * 100; }
  save(pct) { if (this.meta) { this.lastSave = Date.now(); LS.set('sv:p:' + this.meta.id, { i: this.i, o: +(this.o || 0).toFixed(1), pct: pct != null ? pct : this.pct(), sec: this.secs[this.secOf(this.i)].title, t: Date.now() }); } }
  key(k) { return `${this.meta.id}|${S.nvoice}|${AV}|${k}`; }

  /* ----- generation (neural) ----- */
  windowSegs() {
    const w = [];
    if (this.playing || this.waiting) for (let k = this.cur; k <= this.cur + AHEAD && k < this.segs.length; k++) w.push(k);
    if (this.prepSec != null) this.segs.forEach((s, k) => { if (s.s === this.prepSec) w.push(k); });
    return w;
  }
  has(k) { return this.mem.has(k) || this.cached.has(k); }
  genKick() { if (this.mode === 'neural' && this.meta) this.genLoop(); }
  async genLoop() {
    if (this.genBusy) return; this.genBusy = true; let finished = false;
    try {
      for (;;) {
        const k = this.windowSegs().find(x => !this.has(x)); if (k == null) { finished = true; break; }
        if (!(await this.generate(k))) break;
      }
      if (finished && this.prepSec != null) { this.prepSec = null; this.ui.toast('Chapter audio is ready to play offline.'); }
    } finally { this.genBusy = false; this.ui.onStatus(); }
  }
  async generate(k) {
    const seg = this.segs[k]; let ok = false;
    try { ok = await engine.ensure(); } catch {}
    if (!ok) { this.engineFailed(true); return false; }
    const t0 = performance.now(), parts = [], offs = []; let n = 0, chars = 0;
    for (let i = seg.a; i < seg.b; i++) {
      if (!this.windowSegs().includes(k)) return true; // listener moved away – abandon, loop picks the new target
      const [t, f] = this.chunks[i]; let r;
      for (let tries = 0; ; tries++) { try { r = await engine.generate(prepSpeech(t, f), S.nvoice); break; } catch { if (tries >= 1) { this.engineFailed(false); return false; } } }
      offs.push(n / SR); parts.push(r.pcm); n += r.pcm.length; chars += t.length;
      const nx = this.chunks[i + 1], pause = f === 2 ? 0.7 : (nx && nx[1] === 1 ? 0.4 : 0.12), gap = new Float32Array(Math.round(pause * SR)); parts.push(gap); n += gap.length;
    }
    const dur = n / SR; await this.store(k, encodeWav(concat(parts, n), SR), { offs, dur });
    this.rtf = dur / Math.max(0.05, (performance.now() - t0) / 1000);
    if (engine.kind !== 'mock') { this.cps = this.cps * 0.7 + (chars / Math.max(1, dur)) * 0.3; LS.set('sv:cps', this.cps); }
    this.ui.onStatus();
    if (this.playing && this.waiting && k === this.cur) this.playFrom(this.i, this.o);
    return true;
  }
  engineFailed(init) {
    this.pause();
    if (init) { S.quality = 'basic'; LS.set('sv:settings', S); this.ui.toast('The natural voice couldn’t start on this device, so SanaVerse switched to the Basic voice. You can retry in Settings.'); this.ui.onState(); }
    else this.ui.toast('Narration generation failed. Press Play to try again, or switch to the Basic voice in Settings.');
  }
  async store(k, blob, rec) {
    this.mem.set(k, { url: URL.createObjectURL(blob), offs: rec.offs, dur: rec.dur }); this.cached.add(k); this.durs.set(k, rec.dur);
    try { await DB.audioPut({ key: this.key(k), blob, offs: rec.offs, dur: rec.dur }, { key: this.key(k), bookId: this.meta.id, voice: S.nvoice, v: AV, k, size: blob.size, dur: rec.dur, t: Date.now() }); await this.trim(); }
    catch { if (!this.warned) { this.warned = 1; this.ui.toast('Not enough storage to keep generated audio. Playback still works, but audio may be regenerated.'); } }
  }
  async getSeg(k) {
    if (this.mem.has(k)) return this.mem.get(k);
    if (!this.cached.has(k)) return null;
    try { const r = await DB.audioGet(this.key(k)); if (r) { const d = { url: URL.createObjectURL(r.blob), offs: r.offs, dur: r.dur }; this.mem.set(k, d); return d; } } catch {}
    this.cached.delete(k); return null;
  }
  pruneMem() { for (const [k, d] of this.mem) if ((k < this.cur - 1 || k > this.cur + AHEAD + 1) && d !== this.curData) { URL.revokeObjectURL(d.url); this.mem.delete(k); } }
  async trim() { // keep the audio cache under the user's limit: other books first, then segments farthest from here
    const cap = S.cap * 1048576, idx = await DB.audioIdx(); let tot = idx.reduce((a, x) => a + x.size, 0); if (tot <= cap) return;
    const keep = new Set(this.windowSegs().map(k => this.key(k))), me = this.meta.id, c = this.cur;
    const cand = idx.filter(x => !keep.has(x.key)).sort((a, b) => ((a.bookId === me) - (b.bookId === me)) || (a.bookId === me ? Math.abs(b.k - c) - Math.abs(a.k - c) : a.t - b.t));
    const del = []; for (const x of cand) { if (tot <= cap * 0.9) break; tot -= x.size; del.push(x); }
    if (!del.length) return; await DB.audioDelete(del.map(x => x.key));
    del.filter(x => x.bookId === me && x.voice === S.nvoice).forEach(x => { this.cached.delete(x.k); this.durs.delete(x.k); const d = this.mem.get(x.k); if (d && d !== this.curData) { URL.revokeObjectURL(d.url); this.mem.delete(x.k); } });
  }
  async reloadVoice() { this.pause(); this.mem.forEach(d => URL.revokeObjectURL(d.url)); this.mem.clear(); this.curData = null; await this.loadIndex(); this.ui.onStatus(); }
  async clearAudio() { this.mem.forEach(d => d !== this.curData && URL.revokeObjectURL(d.url)); this.mem.clear(); this.cached.clear(); this.durs.clear(); await DB.audioClear().catch(() => {}); this.ui.onStatus(); }
  prepare() { this.prepSec = this.secOf(this.i); this.genKick(); this.ui.onStatus(); }
  ahead() {
    let s = this.curData ? Math.max(0, this.curData.dur - this.au.currentTime) : 0;
    for (let k = this.cur + 1; k < this.segs.length && this.has(k); k++) s += this.durs.get(k) || 0; return s;
  }

  /* ----- playback ----- */
  async play() {
    if (!this.meta) return;
    if (this.done) { this.setI(0); this.o = 0; this.done = false; }
    this.playing = true; this.fails = 0; this.ui.onState();
    if (this.mode === 'basic') return this.basicPlay();
    this.playFrom(this.i, this.o);
  }
  async playFrom(i, off = 0) {
    const tok = ++this.ptok; this.stopSpeech(); this.setI(i); this.o = off; const k = this.cur;
    this.waiting = true; this.genKick(); this.ui.onState();
    const d = await this.getSeg(k);
    if (tok !== this.ptok || !this.playing) return;
    if (!d) { this.setBuffering(); return; } // generate() calls playFrom again when this segment is ready
    this.waiting = false; this.curData = d; this.pruneMem(); this.genKick();
    const au = this.au, t = (d.offs[i - this.segs[k].a] || 0) + off;
    au.loop = false; au.src = d.url;
    au.onloadedmetadata = () => { au.onloadedmetadata = null; try { au.currentTime = Math.min(t, Math.max(0, au.duration - 0.2)); } catch {} au.playbackRate = S.rate; au.play().catch(e => this.playErr(e)); };
    au.preservesPitch = true; au.load(); this.ui.onState(); this.updateMedia(); this.ui.onChange();
  }
  setBuffering() { const au = this.au; this.curData = null; if (!au.loop || !au.src.endsWith(silenceUrl().slice(-12))) { au.src = silenceUrl(); au.loop = true; au.playbackRate = 1; au.play().catch(() => {}); } this.ui.onState(); }
  playErr(e) { if (e && e.name === 'AbortError') return; this.pause(); this.ui.toast(e && e.name === 'NotAllowedError' ? 'Tap Play to start the audio.' : 'The audio couldn’t be played. Press Play to try again.'); }
  onAudioError() { if (!this.playing || !this.curData || this.au.loop) return; const d = this.curData, k = this.cur; URL.revokeObjectURL(d.url); this.mem.delete(k); this.cached.delete(k);
    if (this.fails++ < 1) this.playFrom(this.i, this.o); else { this.pause(); this.ui.toast('This audio couldn’t be played. Press Play to regenerate it.'); } }
  pause() {
    if (!this.meta) return; this.playing = false; this.waiting = false; this.ptok++; this.btok++;
    try { this.au.pause(); this.au.loop = false; } catch {} this.stopSpeech(); this.save(); this.ui.onState(); this.mediaState();
  }
  onTime() {
    if (!this.playing || this.waiting || !this.curData || this.au.loop) return;
    const d = this.curData, seg = this.segs[this.cur], t = this.au.currentTime; let lo = 0, hi = d.offs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (d.offs[m] <= t) lo = m; else hi = m - 1; }
    const i = seg.a + lo; this.o = Math.max(0, t - d.offs[lo]);
    if (i !== this.i) { this.i = i; this.ui.onChange(); this.save(); this.genKick(); } else if (Date.now() - this.lastSave > 3000) this.save();
    this.ui.onTick();
  }
  onEnded() {
    if (this.mode !== 'neural' || !this.playing || this.au.loop) return;
    const k = this.cur + 1;
    if (k >= this.segs.length) return this.finish();
    if (this.sleep.mode === 'sec' && this.segs[k].s !== this.segs[this.cur].s) { this.setI(this.segs[k].a); this.o = 0; this.pause(); this.setSleep(null); this.ui.onChange(); this.ui.toast('Sleep timer: paused at the end of the chapter.'); return; }
    this.fails = 0; this.playFrom(this.segs[k].a, 0);
  }
  finish() { this.playing = false; this.done = true; this.ptok++; this.save(100); this.ui.onState(); this.ui.onChange(); this.ui.toast('You’ve reached the end of the book.'); }
  jump(k, go) { k = Math.max(0, Math.min(this.chunks.length - 1, k)); this.done = false; this.setI(k); this.o = 0; this.fails = 0; this.ui.onChange(); this.save(); this.updateMedia(); if (go || this.playing) this.play(); }
  seek(sec) { // sec of narration (not book text): within the loaded segment if possible, otherwise by text length
    if (this.mode === 'neural' && this.curData && !this.waiting && this.au.duration) { const t = this.au.currentTime + sec; if (t >= 0 && t <= this.au.duration - 0.3) { this.au.currentTime = t; return; } }
    let need = Math.abs(sec) * this.cps, j = this.i;
    if (sec < 0) { while (j > 0 && need > 0) { j--; need -= this.chunks[j][0].length; } } else { while (j < this.chunks.length - 1 && need > 0) { need -= this.chunks[j][0].length; j++; } }
    this.jump(j);
  }
  prevSec() { const s = this.secOf(this.i); this.jump(this.i - this.secs[s].start > 3 || s === 0 ? this.secs[s].start : this.secs[s - 1].start); }
  nextSec() { const s = this.secOf(this.i); if (s + 1 < this.secs.length) this.jump(this.secs[s + 1].start); }
  setRate(r) { S.rate = r; this.au.playbackRate = r; if (this.playing && this.mode === 'basic') this.speak(); }

  /* ----- sleep timer ----- */
  setSleep(m) {
    clearInterval(this.sleep.iv); this.sleep.iv = null; this.sleep.mode = m;
    if (typeof m === 'number') { this.sleep.end = Date.now() + m * 60000; this.sleep.iv = setInterval(() => { if (this.sleep.end - Date.now() <= 0) { this.setSleep(null); this.pause(); this.ui.toast('Sleep timer finished.'); } else this.ui.onSleep(); }, 1000); }
    this.ui.onSleep();
  }

  /* ----- Media Session: lock screen, notification, headset buttons ----- */
  bindMedia() {
    if (this.mediaBound || !('mediaSession' in navigator)) return; this.mediaBound = true;
    const h = (n, f) => { try { navigator.mediaSession.setActionHandler(n, f); } catch {} };
    h('play', () => this.play()); h('pause', () => this.pause()); h('stop', () => this.pause());
    h('previoustrack', () => this.prevSec()); h('nexttrack', () => this.nextSec());
    h('seekbackward', () => this.seek(-15)); h('seekforward', () => this.seek(30));
  }
  updateMedia() {
    if (!('mediaSession' in navigator) || !this.meta || typeof MediaMetadata === 'undefined') return;
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: this.secs[this.secOf(this.i)].title, artist: this.meta.title + (this.meta.author ? ' · ' + this.meta.author : ''), album: 'SanaVerse', artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] }); } catch {}
    this.mediaState();
  }
  mediaState() { if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused'; } catch {} }

  /* ----- Basic voice (device speech synthesis) ----- */
  basicPlay() {
    if (!('speechSynthesis' in window)) { this.playing = false; this.ui.onState(); return this.ui.toast('Your browser can’t read aloud. Try Chrome, Edge or Safari.'); }
    this.wake(); this.speak();
  }
  speak() {
    if (!this.playing) return;
    const tts = window.speechSynthesis, tok = ++this.btok; clearTimeout(this.wd);
    const [t, f] = this.chunks[this.i], u = new SpeechSynthesisUtterance(f === 2 ? t + '.' : t); u.rate = S.rate;
    const v = S.bvoice && tts.getVoices().find(x => x.voiceURI === S.bvoice); if (v) { u.voice = v; u.lang = v.lang; }
    let started = false;
    u.onstart = () => { started = true; this.fails = 0; clearTimeout(this.wd); };
    u.onend = () => { if (tok === this.btok) { clearTimeout(this.wd); this.advance(); } };
    u.onerror = e => { if (tok !== this.btok || e.error === 'canceled' || e.error === 'interrupted') return; this.retry(); };
    this.u = u; const need = tts.speaking || tts.pending; if (need) tts.cancel();
    const go = () => { if (tok === this.btok && this.playing) tts.speak(u); }; need ? setTimeout(go, 60) : go();
    this.wd = setTimeout(() => { if (!started && tok === this.btok) this.retry(); }, 7000);
  }
  retry() { if (++this.fails <= 2) return setTimeout(() => this.speak(), 300); this.pause(); this.ui.toast('Speech stopped. Check your device’s voice settings, then press Play.'); }
  advance() {
    const old = this.secOf(this.i);
    if (this.i >= this.chunks.length - 1) { this.unwake(); return this.finish(); }
    this.setI(this.i + 1); this.o = 0; this.ui.onChange(); this.save();
    if (this.sleep.mode === 'sec' && this.secOf(this.i) !== old) { this.pause(); this.setSleep(null); this.ui.toast('Sleep timer: paused at the end of the chapter.'); return; }
    this.speak();
  }
  stopSpeech() { clearTimeout(this.wd); this.btok++; try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {} this.unwake(); }
  async wake() { try { if ('wakeLock' in navigator && !this.wl) { this.wl = await navigator.wakeLock.request('screen'); this.wl.addEventListener('release', () => this.wl = null); } } catch {} }
  unwake() { try { this.wl && this.wl.release(); } catch {} this.wl = null; }
}
