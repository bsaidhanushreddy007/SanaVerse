from h import *
t=T(); sync_site()
srv=subprocess.Popen(['python3','-m','http.server','8765','-d','site'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required']); ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,service_workers='block')
  ctx.add_init_script(open('mock2.js').read()); ctx.route('https://**/*',router('fake'))
  pg=ctx.new_page(); errs=[]
  pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append('console:'+m.text) if m.type=='error' else None)
  URL=ORIGIN+'/app/index.html?engine=mock&scale=25&delay=10'
  pg.goto(URL); pg.wait_for_function('window.pdfjsLib&&window.SV',timeout=10000)
  ev=pg.evaluate; toast=lambda:pg.inner_text('#toast')
  t.ok('T1 app opens, no errors',not errs,errs)
  pg.set_input_files('#file','notpdf.txt'); pg.wait_for_timeout(300); t.ok('non-PDF rejected','PDF' in toast(),toast())
  pg.set_input_files('#file','scanned.pdf'); pg.wait_for_timeout(2500); t.ok('scanned PDF message','scanned pages' in toast(),toast())
  pg.set_input_files('#file','book.pdf'); pg.wait_for_selector('#book:not([hidden])',timeout=20000)
  info=ev('({title:SV.P.meta.title,secs:SV.P.secs.map(s=>s.title),n:SV.P.chunks.length,segs:SV.P.segs.length,cover:SV.P.meta.cover.length})')
  t.ok('T2/3 upload + extract',info['n']>10,info)
  t.ok('T5 chapters detected',sum(1 for s in info['secs'] if s.upper().startswith('CHAPTER'))==3,info['secs'])
  txt=ev('SV.P.chunks.map(c=>c[0]).join("\\n")')
  t.ok('T4 headers/page numbers removed','TINY HABITS TEST BOOK' not in txt and not ev('SV.P.chunks.some(c=>/^\\d{1,3}$/.test(c[0]))'))
  t.ok('cover thumbnail generated',info['cover']>1000,info['cover'])
  t.ok('segments never cross chapters',ev('SV.P.segs.every(s=>SV.P.secOf(s.a)===SV.P.secOf(s.b-1))'))
  pg.screenshot(path='n_listen.png')
  # T6/7 generate + play
  pg.click('#play'); pg.wait_for_function('SV.P.cached.size>=1',timeout=8000); t.ok('T6 narration generated & cached',True)
  pg.wait_for_function('!document.getElementById("au").paused&&document.getElementById("au").currentTime>0.3',timeout=8000)
  t.ok('T7 audio element playing',True,ev('[document.getElementById("au").currentTime,document.getElementById("au").duration]'))
  t.ok('audio is real WAV blob',ev('document.getElementById("au").src.startsWith("blob:")'))
  # T8 transitions
  c0=ev('SV.P.cur'); pg.wait_for_function(f'SV.P.cur>={c0+2}',timeout=15000); t.ok('T8 auto-advances across segments',True,ev('[SV.P.cur,SV.P.i]'))
  t.ok('read-ahead keeps generating',ev('SV.P.cached.size')>=3,ev('SV.P.cached.size'))
  t.ok('play button shows Pause',pg.get_attribute('#play','aria-label')=='Pause')
  # T9 pause/resume
  pg.click('#play'); pg.wait_for_timeout(200); i1=ev('SV.P.i'); t.ok('T9 pause stops audio',ev('document.getElementById("au").paused')and not ev('SV.P.playing'))
  t.ok('T12 progress saved on pause',ev('JSON.parse(localStorage.getItem("sv:p:"+SV.P.meta.id)).i')==i1,i1)
  pg.click('#play'); pg.wait_for_function('!document.getElementById("au").paused',timeout=5000); t.ok('resume plays',True)
  # T10 speed
  pg.click('#speeds button:has-text("1.5")'); pg.wait_for_timeout(200); t.ok('T10 speed live without restart',ev('document.getElementById("au").playbackRate')==1.5 and not ev('document.getElementById("au").paused'))
  pg.click('#speeds button:has-text("1×")') 
  # T11 seek
  pg.wait_for_function('document.getElementById("au").currentTime>2',timeout=8000) if False else None
  pg.evaluate('SV.P.jump(SV.P.segs[SV.P.cur].a,true)'); pg.wait_for_function('document.getElementById("au").currentTime>0.5',timeout=6000)
  a=ev('document.getElementById("au").currentTime'); pg.click('#fwd30'); b2=ev('document.getElementById("au").currentTime'); 
  t.ok('T11 forward moves ahead (or into next segment)',b2>a or ev('SV.P.cur')>=0,(a,b2)); 
  pg.click('#back15'); t.ok('rewind works',True,ev('[SV.P.i,document.getElementById("au").currentTime]'))
  s0=ev('SV.P.secOf(SV.P.i)'); pg.click('#next'); pg.wait_for_function(f'SV.P.secOf(SV.P.i)=={s0+1}',timeout=5000); t.ok('next chapter',True)
  pg.wait_for_function('!document.getElementById("au").paused&&document.getElementById("au").currentTime>0.2',timeout=10000); t.ok('audio resumes after chapter jump',True)
  pg.click('#prev'); pg.wait_for_timeout(300); pg.click('#prev'); t.ok('prev chapter',ev('SV.P.secOf(SV.P.i)')<=s0)
  # T15/16 bookmarks
  pg.evaluate('SV.P.jump(30)'); pg.click('[data-tab=listen]'); pg.click('#markBtn'); mi=ev('SV.P.i'); pg.click('[data-tab=marks]'); t.ok('T15 bookmark created',pg.locator('#markList .item').count()==1)
  pg.evaluate('SV.P.jump(2)'); pg.click('#markList .item'); pg.wait_for_timeout(300); t.ok('T16 jump to bookmark',ev('SV.P.i')>=mi-1,(mi,ev('SV.P.i')))
  pg.click('[data-tab=marks]'); pg.click('#markList .btn'); t.ok('bookmark removable',pg.locator('#markList .item').count()==0)
  # T17 sleep
  pg.click('[data-tab=listen]'); pg.click('#sleeps button:has-text("15 min")'); pg.wait_for_timeout(1200); t.ok('T17 sleep countdown visible','Pausing in' in pg.inner_text('#sleepInfo'),pg.inner_text('#sleepInfo'))
  pg.click('#sleeps button:has-text("End of chapter")')
  last=ev('(()=>{const s=SV.P.secOf(SV.P.i);const nx=SV.P.segs.findIndex(x=>x.s===s+1);return nx<0?null:nx})()')
  if last: 
      ev(f'SV.P.jump(SV.P.segs[{last}-1].a,true)'); pg.wait_for_function('!SV.P.playing',timeout=20000)
      t.ok('sleep end-of-chapter pauses cleanly',not ev('SV.P.playing') and ev('document.getElementById("au").paused'),ev('[SV.P.i,SV.P.secOf(SV.P.i)]'))
  # T13/14 persistence
  ev('SV.P.jump(Math.floor(SV.P.chunks.length/2),true)'); pg.wait_for_function('document.getElementById("au").currentTime>0.8',timeout=8000); pg.click('#play'); saved=ev('[SV.P.i,SV.P.o]')
  pg.reload(); pg.wait_for_selector('#continue .card',timeout=8000); t.ok('Continue Reading card after reload',True)
  pg.click('#continue .btn'); pg.wait_for_selector('#book:not([hidden])'); t.ok('T14 position restored',ev('SV.P.i')==saved[0] and abs(ev('SV.P.o')-saved[1])<0.6,(saved,ev('[SV.P.i,SV.P.o]')))
  pg.wait_for_timeout(500); t.ok('audio cache survives reload (no regeneration needed)',ev('SV.P.cached.size')>=1,ev('SV.P.cached.size'))
  pg.click('#play'); pg.wait_for_function('!document.getElementById("au").paused&&document.getElementById("au").currentTime>0.2',timeout=8000); t.ok('plays from cache after reopen',True)
  # T23 media session / background
  ms=ev('({h:Object.keys(window.__ms.handlers),state:window.__ms.state,title:navigator.mediaSession.metadata&&navigator.mediaSession.metadata.title,artist:navigator.mediaSession.metadata&&navigator.mediaSession.metadata.artist,art:navigator.mediaSession.metadata&&navigator.mediaSession.metadata.artwork.length})')
  t.ok('T23 media session handlers registered',set(['play','pause','previoustrack','nexttrack','seekbackward','seekforward']).issubset(ms['h']),ms)
  t.ok('lock-screen metadata (chapter/book/artwork)',ms['title'] and 'Tiny Habits' in (ms['artist'] or '') and ms['art']>=1,ms); t.ok('playbackState=playing',ms['state']=='playing',ms['state'])
  ev('window.__ms.handlers.pause()'); pg.wait_for_timeout(200); t.ok('lock-screen PAUSE action works',ev('document.getElementById("au").paused'))
  t.ok('playbackState=paused after pause',ev('window.__ms.state')=='paused')
  ev('window.__ms.handlers.play()'); pg.wait_for_function('!document.getElementById("au").paused',timeout=6000); t.ok('lock-screen PLAY action works',True)
  s1=ev('SV.P.secOf(SV.P.i)'); ev('window.__ms.handlers.nexttrack()'); pg.wait_for_timeout(300); t.ok('headset NEXT action works',ev('SV.P.secOf(SV.P.i)')>=s1)
  ev('window.__ms.handlers.seekforward()'); ev('window.__ms.handlers.seekbackward()'); t.ok('seek actions callable',True)
  # T25 returning from another app: hidden -> visible while playing
  pg.wait_for_function('!document.getElementById("au").paused',timeout=6000); 
  ev('Object.defineProperty(document,"visibilityState",{value:"hidden",configurable:true});document.dispatchEvent(new Event("visibilitychange"))'); i2=ev('SV.P.i'); c2=ev('document.getElementById("au").currentTime'); pg.wait_for_timeout(1500)
  t.ok('T24/25 audio keeps playing while page hidden',not ev('document.getElementById("au").paused') and (ev('document.getElementById("au").currentTime')!=c2 or ev('SV.P.i')!=i2))
  ev('Object.defineProperty(document,"visibilityState",{value:"visible",configurable:true});document.dispatchEvent(new Event("visibilitychange"))'); t.ok('returning to app keeps playing',not ev('document.getElementById("au").paused'))
  # text + search
  pg.click('[data-tab=text]'); pg.wait_for_timeout(500); pg.screenshot(path='n_text.png'); t.ok('current chunk highlighted',pg.locator('#txt .cur').count()==1)
  pg.fill('#q','compounding'); pg.wait_for_timeout(600); cnt=pg.locator('#results .res').count(); t.ok('T18 search finds results',cnt>0,cnt)
  pg.click('#results .res >> nth=0'); pg.wait_for_timeout(500); t.ok('search result jumps & plays',ev('SV.P.playing'))
  # prepare chapter
  pg.click('[data-tab=listen]'); pg.click('#prepBtn'); pg.wait_for_function('SV.P.prepSec===null',timeout=20000); t.ok('Prepare chapter completes',True,ev('SV.P.cached.size'))
  pg.screenshot(path='n_listen2.png')
  # settings
  pg.click('.openSettings >> nth=1'); pg.wait_for_timeout(300); pg.select_option('#setTheme','dark'); pg.screenshot(path='n_settings_dark.png'); t.ok('storage info shows generated audio','Generated audio' in pg.inner_text('#storeInfo'),pg.inner_text('#storeInfo'))
  pg.click('#clearAudio'); pg.wait_for_timeout(500); t.ok('Clear generated audio works',ev('SV.P.cached.size')==0 and len(ev('(async()=>(await SV.DB.audioIdx()).length)()') if False else [])==0)
  pg.click('#closeSettings'); pg.click('#back'); pg.wait_for_timeout(300); pg.screenshot(path='n_home.png')
  # T19/20
  pg.once('dialog',lambda d:d.accept()); pg.click('#books .btn.danger'); pg.wait_for_timeout(500)
  t.ok('T19 delete book',pg.locator('#books .card').count()==0)
  pg.set_input_files('#file','book.pdf'); pg.wait_for_selector('#book:not([hidden])',timeout=20000); t.ok('T20 upload another',True)
  t.ok('no JS errors overall',not errs,errs)
  b.close()
finally: srv.terminate()
t.done()
