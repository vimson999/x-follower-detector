const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function harness(){
  let listener;const local={},session={};
  const storage=s=>({get:async k=>({[k]:s[k]}),set:async o=>Object.assign(s,structuredClone(o)),remove:async k=>delete s[k]});
  const chrome={runtime:{id:'ext',onMessage:{addListener:fn=>listener=fn}},storage:{local:storage(local),session:storage(session)}};
  const ctx=vm.createContext({chrome,Date,Math,URL,console});
  vm.runInContext(fs.readFileSync('src/recorder/background.js','utf8'),ctx);
  const send=(m,tab=null)=>new Promise(resolve=>{if(!listener(m,{id:'ext',url:tab===null?'chrome-extension://ext/src/popup/index.html':'https://x.com/alice',...(tab===null?{}:{tab:{id:tab}})},resolve))resolve({ok:false});});
  return {send,local,session};
}
test('recording requires start, binds tab/token, stops stale writes, preserves prior events',async()=>{
 const h=harness();assert.equal((await h.send({type:'RECORD_STATUS'},1)).active,null);
 const started=await h.send({type:'RECORD_START',tabId:1,pageUrl:'https://x.com/alice?secret=123'});
 assert.equal(started.ok,true);const token=started.active.token;
 const append=()=>h.send({type:'RECORD_EVENT',token,event:{type:'click',pageUrl:'https://x.com/alice?secret=123',target:{tag:'button',testId:'reply',label:'Reply'},post:{id:'123',url:'https://x.com/alice/status/123'},text:'PRIVATE'}},1);
 assert.equal((await h.send({type:'RECORD_EVENT',token,event:{type:'click'}},2)).ignored,true);
 assert.equal((await append()).ok,true);
 assert.equal(h.local.operationRecording.events[1].pageUrl,'https://x.com/alice');
 assert.equal(h.local.operationRecording.events[1].text,undefined);
 await h.send({type:'RECORD_STOP'});const n=h.local.operationRecording.events.length;
 assert.equal((await append()).ignored,true);assert.equal(h.local.operationRecording.events.length,n);
 await h.send({type:'RECORD_START',tabId:1,pageUrl:'https://x.com/alice'});
 assert.ok(h.local.operationRecording.events.length>n);
 assert.equal((await h.send({type:'RECORD_CLEAR'})).ok,false);
 await h.send({type:'RECORD_STOP'});await h.send({type:'RECORD_CLEAR'});
 assert.equal(h.local.operationRecording,undefined);
});
test('rejects non-X starts and arbitrary event types; serializes simultaneous events',async()=>{
 const h=harness();assert.equal((await h.send({type:'RECORD_START',tabId:1,pageUrl:'https://example.com'})).ok,false);
 const {active}=await h.send({type:'RECORD_START',tabId:1,pageUrl:'https://x.com/alice'});
 assert.equal((await h.send({type:'RECORD_EVENT',token:active.token,event:{type:'keydown',value:'secret'}},1)).ok,false);
 await Promise.all(Array.from({length:12},()=>h.send({type:'RECORD_EVENT',token:active.token,event:{type:'scroll',pageUrl:'https://x.com/alice',x:0,y:100}},1)));
 assert.equal(h.local.operationRecording.events.length,13);
 assert.deepEqual(h.local.operationRecording.events.map(e=>e.sequence),Array.from({length:13},(_,i)=>i+1));
});
test('at the event limit recording stops without erasing saved events',async()=>{
 const h=harness();const {active}=await h.send({type:'RECORD_START',tabId:1,pageUrl:'https://x.com/alice'});
 h.local.operationRecording.events=Array.from({length:4999},(_,i)=>({sequence:i+1,type:'click'}));
 const r=await h.send({type:'RECORD_EVENT',token:active.token,event:{type:'scroll',pageUrl:'https://x.com/alice',y:20}},1);
 assert.equal(r.limited,true);assert.equal(r.active,null);assert.equal(h.local.operationRecording.events.length,5000);
 assert.equal((await h.send({type:'RECORD_START',tabId:1,pageUrl:'https://x.com/alice'})).ok,false);
 assert.equal((await h.send({type:'RECORD_EVENT',token:active.token,event:{type:'scroll'}},1)).ignored,true);
});
