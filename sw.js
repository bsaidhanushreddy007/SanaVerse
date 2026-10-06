/* SanaVerse service worker: opens the app offline after the first visit. Book text and narration live in IndexedDB (not here);
   the neural voice model is cached by the voice engine itself in the Cache API ("transformers-cache"). */
const V = 'sanaverse-v3';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'app.js', 'native.js', 'tts-worker.js'];
const CDN = ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all([c.addAll(SHELL), ...CDN.map(u => c.add(u).catch(() => {}))])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sanaverse-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const put = (r, res) => { if (res && res.status === 200) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; };
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) { // app files: network first (so updates arrive), cache as the offline fallback
    e.respondWith(fetch(r).then(res => put(r, res)).catch(() => caches.match(r).then(m => m || caches.match('index.html'))));
  } else if (CDN_HOSTS.includes(u.hostname)) { // pinned library files: cache first
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => put(r, res))));
  }
});
