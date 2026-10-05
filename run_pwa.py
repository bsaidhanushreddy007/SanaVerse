from h import *
t=T(); sync_site()
srv=subprocess.Popen(['python3','-m','http.server','8766','-d','site'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844}); pg=ctx.new_page(); errs=[]
  pg.on('pageerror',lambda e:errs.append(str(e)))
  pg.goto('http://localhost:8766/index.html'); pg.wait_for_function('navigator.serviceWorker.ready.then(()=>true)',timeout=10000)
  pg.wait_for_function('navigator.serviceWorker.controller||true'); pg.reload(); pg.wait_for_timeout(1500)
  t.ok('T22 service worker active and controlling',pg.evaluate('!!navigator.serviceWorker.controller'))
  m=pg.evaluate('fetch("manifest.json").then(r=>r.json())'); t.ok('manifest: standalone, name, start_url',m['display']=='standalone' and m['name']=='SanaVerse' and m['start_url'])
  sizes=set()
  for ic in m['icons']:
      r=pg.evaluate('u=>fetch(u).then(r=>[r.status,r.headers.get("content-type")])',ic['src']); sizes.add((ic['sizes'],ic.get('purpose','any'))); assert r[0]==200,(ic,r)
  t.ok('icons 192/512 + maskable all load',{('192x192','any'),('512x512','any'),('512x512','maskable')}.issubset(sizes),sizes)
  cached=pg.evaluate('caches.open("sanaverse-v2").then(c=>c.keys()).then(k=>k.map(x=>new URL(x.url).pathname))'); 
  miss=[f for f in ['/index.html','/js/app.js','/js/player.js','/js/tts.js','/js/tts-worker.js','/js/extract.js','/js/storage.js','/styles.css','/icon-512.png'] if f not in cached]
  t.ok('app shell precached',not miss,miss)
  ctx.set_offline(True); pg.reload(); pg.wait_for_timeout(1500)
  t.ok('opens fully OFFLINE from cache',pg.inner_text('.brand')=='SanaVerse' and pg.evaluate('!!window.SV'),pg.title())
  pg.screenshot(path='n_offline.png'); t.ok('no JS errors',not errs,errs); b.close()
finally: srv.terminate()
t.done()
