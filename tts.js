/* SanaVerse – speech engine wrapper: text → PCM audio. "kokoro" = real neural voice in a worker; "mock" = test double (?engine=mock). */
import { LS } from './storage.js';
export const SR = 24000;
export const VOICES = [['af_heart', 'Heart – US English, female'], ['af_bella', 'Bella – US English, female'], ['af_nicole', 'Nicole – US English, female (soft)'], ['af_sarah', 'Sarah – US English, female'],
  ['am_adam', 'Adam – US English, male'], ['am_michael', 'Michael – US English, male'], ['bf_emma', 'Emma – British English, female'], ['bm_george', 'George – British English, male']];
const Q = new URLSearchParams(location.search);
const MOCK = Q.get('engine') === 'mock', MOCK_SCALE = +(Q.get('scale') || 20), MOCK_DELAY = +(Q.get('delay') || 20);

class Engine {
  constructor() { this.state = 'idle'; this.mb = 0; this.totalMb = 0; this.listeners = []; this.pending = new Map(); this.n = 0; this.files = {}; this.kind = MOCK ? 'mock' : 'kokoro'; }
  get supported() { return MOCK || (typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined'); }
  get ready() { return this.state === 'ready'; }
  get modelKnown() { return MOCK || LS.get('sv:model', false); }
  on(fn) { this.listeners.push(fn); }
  set(state) { this.state = state; this.listeners.forEach(f => f(this)); }
  ensure() {
    if (this.ready) return Promise.resolve(true);
    if (this.init) return this.init;
    this.init = new Promise(ok => {
      if (MOCK) { this.set('ready'); return ok(true); }
      try { this.w = new Worker('js/tts-worker.js', { type: 'module' }); } catch { this.error = 'Workers unavailable'; this.set('error'); return ok(false); }
      this.set(this.modelKnown ? 'loading' : 'downloading');
      this.w.onmessage = e => this.msg(e.data, ok);
      this.w.onerror = () => { this.error = 'Voice engine failed to start'; this.set('error'); ok(false); };
      this.w.postMessage({ type: 'init' });
    }).then(r => { if (!r) { this.init = null; try { this.w && this.w.terminate(); } catch {} } return r; });
    return this.init;
  }
  msg(m, ok) {
    if (m.type === 'progress') {
      const p = m.p || {};
      if (p.file && p.total) this.files[p.file] = { l: p.loaded || 0, t: p.total };
      const f = Object.values(this.files), L = f.reduce((a, x) => a + x.l, 0), T = f.reduce((a, x) => a + x.t, 0);
      this.mb = L / 1048576; this.totalMb = T / 1048576; this.set(this.state === 'ready' ? 'ready' : (T && L < T ? 'downloading' : 'loading'));
    } else if (m.type === 'ready') { LS.set('sv:model', true); this.set('ready'); ok(true); }
    else if (m.type === 'error') { this.error = m.msg; this.set('error'); ok(false); }
    else if (m.type === 'audio') { const p = this.pending.get(m.id); p && (this.pending.delete(m.id), p.ok({ pcm: m.pcm, sr: m.sr })); }
    else if (m.type === 'genError') { const p = this.pending.get(m.id); p && (this.pending.delete(m.id), p.no(new Error(m.msg))); }
  }
  generate(text, voice) {
    if (MOCK) return new Promise(ok => setTimeout(() => { // silence-with-a-tone whose length mimics real speech (~15 chars/s, sped up by ?scale)
      const n = Math.max(2400, Math.round(text.length / 15 / MOCK_SCALE * SR)), a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = 0.02 * Math.sin(i * 0.05); ok({ pcm: a, sr: SR }); }, MOCK_DELAY));
    return new Promise((ok, no) => { const id = ++this.n; this.pending.set(id, { ok, no }); this.w.postMessage({ type: 'gen', id, text, voice }); });
  }
  async removeModel() {
    try { this.w && this.w.terminate(); } catch {} this.w = null; this.init = null; this.files = {}; this.pending.clear();
    try { await caches.delete('transformers-cache'); } catch {}
    LS.set('sv:model', false); this.set('idle');
  }
}
export const engine = new Engine();

export function encodeWav(pcm, sr = SR) { // Float32 mono → 16-bit PCM WAV
  const n = pcm.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}
let sil; export const silenceUrl = () => sil || (sil = URL.createObjectURL(encodeWav(new Float32Array(SR / 2), SR))); // keeps the media session alive while narration is being prepared
