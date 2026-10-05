/* SanaVerse – on-device storage. Text + audio in IndexedDB; progress, bookmarks, settings in localStorage. Nothing leaves the device. */
export const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
export const S = Object.assign({ theme: 'auto', rate: 1, size: 19, quality: 'natural', nvoice: 'af_heart', bvoice: '', cap: 500 }, LS.get('sv:settings', {}));
if (S.voice && !S.bvoice) { S.bvoice = S.voice; delete S.voice; } // settings from the first (browser-voice-only) version
export const saveS = () => LS.set('sv:settings', S);

const STORES = ['meta', 'text', 'audio', 'ai'];
export const DB = {
  open() {
    return this.p || (this.p = new Promise((ok, no) => {
      const r = indexedDB.open('sanaverse', 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        ['meta', 'text'].forEach(n => db.objectStoreNames.contains(n) || db.createObjectStore(n, { keyPath: 'id' }));
        ['audio', 'ai'].forEach(n => db.objectStoreNames.contains(n) || db.createObjectStore(n, { keyPath: 'key' }));
      };
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    }));
  },
  async run(names, mode, fn) {
    const db = await this.open();
    return new Promise((ok, no) => {
      const t = db.transaction(names, mode); const out = fn(...names.map(n => t.objectStore(n)));
      t.oncomplete = () => ok(out && 'result' in out ? out.result : undefined); t.onerror = t.onabort = () => no(t.error);
    });
  },
  metas() { return this.run(['meta'], 'readonly', m => m.getAll()); },
  text(id) { return this.run(['text'], 'readonly', t => t.get(id)); },
  put(meta, text) { return this.run(['meta', 'text'], 'readwrite', (m, t) => { m.put(meta); t.put(text); }); },
  async del(id) { await this.audioClear(id); return this.run(['meta', 'text'], 'readwrite', (m, t) => { m.delete(id); t.delete(id); }); },
  clear() { return this.run(STORES, 'readwrite', (...s) => s.forEach(x => x.clear())); },
  /* generated narration, one record per segment (~1 minute) */
  audioGet(key) { return this.run(['audio'], 'readonly', a => a.get(key)); },
  audioPut(rec, idx) { return this.run(['audio', 'ai'], 'readwrite', (a, i) => { a.put(rec); i.put(idx); }); },
  audioIdx() { return this.run(['ai'], 'readonly', i => i.getAll()); },
  audioDelete(keys) { return this.run(['audio', 'ai'], 'readwrite', (a, i) => keys.forEach(k => { a.delete(k); i.delete(k); })); },
  async audioClear(bookId) {
    if (!bookId) return this.run(['audio', 'ai'], 'readwrite', (a, i) => { a.clear(); i.clear(); });
    const idx = (await this.audioIdx()).filter(x => x.bookId === bookId).map(x => x.key); return idx.length ? this.audioDelete(idx) : undefined;
  }
};
