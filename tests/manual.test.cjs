const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const tick=()=>new Promise(r=>setImmediate(r));
function workerHarness() {
  let listener;const local={},session={};
  const storage=store=>({get:async key=>key===null?{...store}:{[key]:store[key]},set:async obj=>Object.assign(store,obj),remove:async key=>{delete store[key];}});
  const chrome={runtime:{id:'ext',onMessage:{addListener:fn=>listener=fn}},storage:{local:storage(local),session:storage(session)}};
  const ctx=vm.createContext({URL,Date,Math,console,chrome});
  ctx.importScripts=()=>vm.runInContext(fs.readFileSync('src/collector/core.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync('src/collector/background.js','utf8'),ctx);
  const send=(message,tab=1)=>new Promise(resolve=>listener(message,tab===null?{id:'ext',url:'chrome-extension://ext/src/popup/index.html'}:{id:'ext',url:'https://x.com/alice',tab:{id:tab}},resolve));
  const save=token=>send({type:'CAPTURE_SAVE',captureToken:token,context:{userId:'1',handle:'alice',tab:'posts',operation:'UserTweets',pageUrl:'https://x.com/alice'},capturedAt:new Date().toISOString(),data:{data:{user:{result:{timeline_v2:{timeline:{instructions:[{entries:[{content:{itemContent:{tweet_results:{result:{rest_id:'100',legacy:{full_text:'hi'}}}}}}]}]}}}}}}});
  return {send,save,local};
}
test('manual capture defaults off, start/stop gates saves, resume keeps data',async()=>{
  const h=workerHarness();
  assert.equal((await h.save('fake')).ignored,true);
  assert.equal(h.local['capture:1:posts'],undefined);
  const start=await h.send({type:'CAPTURE_START',pageUrl:'https://x.com/alice'});
  assert.equal(start.ok,true);assert.ok(start.session.token);
  assert.equal((await h.save(start.session.token)).ok,true);
  await h.send({type:'CAPTURE_STOP'});
  assert.equal((await h.save(start.session.token)).ignored,true);
  const next=await h.send({type:'CAPTURE_START',pageUrl:'https://x.com/alice'});
  assert.notEqual(start.session.token,next.session.token);
  assert.equal((await h.save(start.session.token)).ignored,true);
  await h.save(next.session.token);
  assert.equal(Object.keys(h.local['capture:1:posts'].items).length,1);
});
test('clear affects selected bucket, invalidates active sessions, stale responses cannot recreate it',async()=>{
  const h=workerHarness();
  const start=await h.send({type:'CAPTURE_START',pageUrl:'https://x.com/alice'});await h.save(start.session.token);
  h.local['capture:2:posts']={items:{other:{id:'other'}}};
  const result=await h.send({type:'CAPTURE_CLEAR',key:'capture:1:posts'},null);
  assert.equal(result.ok,true);assert.equal(h.local['capture:1:posts'],undefined);
  assert.equal(h.local.captureIndex['capture:1:posts'],undefined);
  assert.ok(h.local['capture:2:posts']);
  assert.equal((await h.save(start.session.token)).ignored,true);
  assert.equal(h.local['capture:1:posts'],undefined);
});
test('network does not clone while stopped; stop/start discards in-flight old response',async()=>{
  let handler,resolve;const sent=[];const events={};
  class XHR{open(){}send(){}addEventListener(){}}
  const ctx=vm.createContext({URL,Date,console,XMLHttpRequest:XHR,location:{href:'https://x.com/alice',origin:'https://x.com'},fetch:()=>new Promise(r=>resolve=r),addEventListener:(t,fn)=>{events[t]=fn;if(t==='message')handler=fn;},postMessage:m=>sent.push(m)});ctx.window=ctx;
  vm.runInContext(fs.readFileSync('src/collector/core.js','utf8'),ctx);vm.runInContext(fs.readFileSync('src/collector/network.js','utf8'),ctx);
  ctx.dispatch=handler;
  const control=token=>{ctx.token=token;vm.runInContext("dispatch({source:window,origin:location.origin,data:{channel:'X_FOLLOW_CAPTURE_V1',type:'CONTROL',session:token?{token,handle:'alice',tab:'posts'}:null}})",ctx);};
  vm.runInContext("dispatch({source:window,origin:location.origin,data:{channel:'X_FOLLOW_CAPTURE_V1',type:'READY'}})",ctx);
  const api='https://x.com/i/api/graphql/h/UserTweets?variables=%7B%22userId%22%3A%221%22%7D';
  let clones=0;const response={ok:true,clone:()=>{clones++;return{json:async()=>({data:{}})};}};
  let p=ctx.fetch(api);resolve(response);await p;await tick();assert.equal(clones,0);
  control('old');p=ctx.fetch(api);control(null);control('new');resolve(response);await p;await tick();assert.equal(sent.filter(m=>m.type==='RESPONSE').length,0);
  p=ctx.fetch(api);resolve(response);await p;await tick();assert.equal(sent.filter(m=>m.type==='RESPONSE')[0].captureToken,'new');
  events.pagehide();
  p=ctx.fetch(api);resolve(response);await p;await tick();assert.equal(sent.filter(m=>m.type==='RESPONSE').length,1);
  events.pageshow({persisted:true});
  p=ctx.fetch(api);resolve(response);await p;await tick();assert.equal(sent.filter(m=>m.type==='RESPONSE').length,1);
});
