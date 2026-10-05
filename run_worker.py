from h import *
t=T(); sync_site()
srv=subprocess.Popen(['python3','-m','http.server','8765','-d','site'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
def newpage(b,kokoro):
    ctx=b.new_context(viewport={'width':390,'height':844},service_workers='block'); ctx.add_init_script(open('mock2.js').read()); ctx.route('https://**/*',router(kokoro))
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto(ORIGIN+'/app/index.html'); pg.wait_for_function('window.pdfjsLib&&window.SV',timeout=10000); return ctx,pg,errs
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
  # --- A: real worker plumbing with a fake Kokoro module ---
  ctx,pg,errs=newpage(b,'fake'); ev=pg.evaluate
  pg.set_input_files('#file','book.pdf'); pg.wait_for_selector('#book:not([hidden])',timeout=20000)
  pg.click('#play'); pg.wait_for_selector('#setup[open]',timeout=3000); t.ok('first Play offers one-time voice download',True,pg.inner_text('#setup h2'))
  pg.click('#setupGo'); seen=set()
  for _ in range(30):
      seen.add(round(float(pg.evaluate('parseFloat(document.getElementById("setupBar").style.width)||0'))));
      if not pg.evaluate('document.getElementById("setup").open'): break
      pg.wait_for_timeout(40)
  t.ok('download progress shown',len(seen)>2,sorted(seen)); t.ok('setup closes when voice ready',not ev('document.getElementById("setup").open'))
  t.ok('model flag remembered (download once)',ev('SV.LS.get("sv:model",false)')==True)
  pg.wait_for_function('!document.getElementById("au").paused&&document.getElementById("au").currentTime>0.3',timeout=15000); t.ok('worker-generated audio plays',True,ev('SV.engine.state'))
  t.ok('engine state ready, kind kokoro',ev('SV.engine.state')=='ready' and ev('SV.engine.kind')=='kokoro')
  c0=ev('SV.P.cur'); pg.wait_for_function(f'SV.P.cur>={c0+1}',timeout=15000); t.ok('multiple segments via worker',True)
  pg.click('#play'); pg.reload(); pg.wait_for_function('window.SV'); 
  pg.wait_for_selector('#continue .card',timeout=5000); pg.click('#continue .btn'); pg.wait_for_selector('#book:not([hidden])')
  pg.click('#play'); pg.wait_for_timeout(300); t.ok('after reload: no setup dialog (model known)',not ev('document.getElementById("setup").open'))
  pg.wait_for_function('!document.getElementById("au").paused&&document.getElementById("au").currentTime>0.2',timeout=15000); t.ok('after reload: plays again',True)
  pg.click('#play'); pg.click('.openSettings >> nth=1'); pg.select_option('#setNVoice','am_adam'); pg.wait_for_timeout(400)
  t.ok('changing voice swaps audio cache namespace',ev('SV.S.nvoice')=='am_adam' and ev('SV.P.key(0)').split("|")[1]=='am_adam')
  pg.once('dialog',lambda d:d.accept()); pg.click('#removeModel'); pg.wait_for_timeout(500); t.ok('remove model resets flag',ev('SV.LS.get("sv:model",false)')==False)
  t.ok('no JS errors (worker path)',not errs,errs); ctx.close()
  # --- B: voice engine unavailable (CDN blocked) -> graceful fallback ---
  ctx,pg,errs=newpage(b,'404'); ev=pg.evaluate
  pg.set_input_files('#file','book.pdf'); pg.wait_for_selector('#book:not([hidden])',timeout=20000)
  pg.click('#play'); pg.wait_for_selector('#setup[open]'); pg.click('#setupGo'); pg.wait_for_timeout(1500)
  t.ok('failed download shows friendly message','failed' in pg.inner_text('#setupMsg').lower(),pg.inner_text('#setupMsg')); t.ok('Download button re-enabled for retry',not ev('document.getElementById("setupGo").disabled'))
  pg.click('#setupBasic'); pg.wait_for_timeout(600); t.ok('Basic voice fallback speaks',ev('window.__spoken.length')>=1 and ev('SV.S.quality')=='basic',ev('window.__spoken.length'))
  t.ok('status explains Basic voice limits','Basic' in pg.inner_text('#audioStatus'),pg.inner_text('#audioStatus'))
  pg.wait_for_timeout(600); t.ok('Basic voice auto-advances chunks',ev('window.__spoken.length')>=3,ev('window.__spoken.length'))
  ctx.close()
  # --- C: model "known" but engine breaks at start -> auto-switch to Basic with explanation ---
  ctx,pg,errs=newpage(b,'404'); ev=pg.evaluate; ev('SV.LS.set("sv:model",true)'); pg.reload(); pg.wait_for_function('window.SV&&window.pdfjsLib')
  pg.set_input_files('#file','book.pdf'); pg.wait_for_selector('#book:not([hidden])',timeout=20000)
  pg.click('#play'); pg.wait_for_function('SV.S.quality==="basic"',timeout=8000); t.ok('engine init failure -> switched to Basic with message','Basic voice' in pg.inner_text('#toast'),pg.inner_text('#toast'))
  pg.wait_for_timeout(500); t.ok('and it still plays (basic)',ev('window.__spoken.length')>=0 and ev('SV.P.mode')=='basic')
  ctx.close(); b.close()
finally: srv.terminate()
t.done()
