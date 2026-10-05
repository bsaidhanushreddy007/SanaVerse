(()=>{const log=[];window.__spoken=log;let cur=null;const voices=[{name:'Test Voice',lang:'en-US',voiceURI:'t'}];
window.SpeechSynthesisUtterance=class{constructor(t){this.text=t}};
const ss={speaking:false,pending:false,speak(u){cur=u;ss.speaking=true;log.push({t:u.text,r:u.rate});u._t=[setTimeout(()=>{u.onstart&&u.onstart({})},3),setTimeout(()=>{if(cur!==u)return;cur=null;ss.speaking=false;u.onend&&u.onend({})},120)]},
 cancel(){if(cur){cur._t.forEach(clearTimeout);const u=cur;cur=null;ss.speaking=false;u.onerror&&u.onerror({error:'canceled'})}},getVoices(){return voices},onvoiceschanged:null};
Object.defineProperty(window,'speechSynthesis',{value:ss,configurable:true});
for(const C of [Map,WeakMap]){C.prototype.getOrInsert||(C.prototype.getOrInsert=function(k,v){if(!this.has(k))this.set(k,v);return this.get(k)});C.prototype.getOrInsertComputed||(C.prototype.getOrInsertComputed=function(k,f){if(!this.has(k))this.set(k,f(k));return this.get(k)});}
// record Media Session registrations (what the OS lock screen / headset would call)
window.__ms={handlers:{},meta:null,state:null};
if(navigator.mediaSession){const ms=navigator.mediaSession,orig=ms.setActionHandler.bind(ms);ms.setActionHandler=(n,f)=>{window.__ms.handlers[n]=f;try{orig(n,f)}catch{}};
 let st='none';Object.defineProperty(ms,'playbackState',{get(){return st},set(v){st=v;window.__ms.state=v}});}
})();
