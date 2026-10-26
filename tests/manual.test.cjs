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
  const send=(message,tab=1)=>new Promise(resolve=>{const handled=listener(message,tab===null?{id:'ext',url:'chrome-extension://ext/src/popup/index.html'}:{id:'ext',url:'https://x.com/alice',tab:{id:tab}},resolve);if(!handled) resolve({ok:false,error:'unhandled'});});
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
  control(null);let p=ctx.fetch(api);resolve(response);await p;await tick();assert.equal(clones,0);
  control('old');p=ctx.fetch(api);control(null);control('new');resolve(response);await p;await tick();assert.equal(sent.filter(m=>m.type==='RESPONSE').length,0);
  p=ctx.fetch(api);resolve(response);await p;await tick();assert.equal(sent.filter(m=>m.type==='RESPONSE')[0].captureToken,'new');
  events.pagehide();
  p=ctx.fetch(api);resolve(response);await p;await tick();assert.equal(sent.filter(m=>m.type==='RESPONSE').length,1);
  events.pageshow({persisted:true});
  p=ctx.fetch(api);resolve(response);await p;await tick();assert.equal(sent.filter(m=>m.type==='RESPONSE').length,1);
});

test('same-user route transition preserves token and accepts separate reply bucket', async()=>{
  const h=workerHarness();
  const start=await h.send({type:'CAPTURE_START',pageUrl:'https://x.com/alice'});
  await h.save(start.session.token);
  const route=await h.send({type:'CAPTURE_ROUTE',pageUrl:'https://x.com/alice/with_replies'});
  assert.equal(route.session?.token,start.session.token);
  const result=await h.send({type:'CAPTURE_SAVE',captureToken:start.session.token,
    context:{userId:'1',handle:'alice',tab:'replies',operation:'UserTweetsAndReplies',pageUrl:'https://x.com/alice/with_replies'},
    capturedAt:new Date().toISOString(),data:{data:{user:{result:{timeline:{timeline:{instructions:[{entries:[{content:{itemContent:{tweet_results:{result:{rest_id:'200',legacy:{full_text:'reply'}}}}}}]}]}}}}}}});
  assert.equal(result.count,1);
  assert.ok(h.local['capture:1:posts']);assert.ok(h.local['capture:1:replies']);
  const other=await h.send({type:'CAPTURE_ROUTE',pageUrl:'https://x.com/bob'});
  assert.equal(other.session,null);
  assert.equal((await h.save(start.session.token)).ignored,true);
});

test('unsupported timeline shape reports failure instead of creating an empty bucket', async()=>{
  const h=workerHarness();
  const start=await h.send({type:'CAPTURE_START',pageUrl:'https://x.com/alice'});
  const result=await h.send({type:'CAPTURE_SAVE',captureToken:start.session.token,
    context:{userId:'1',handle:'alice',tab:'posts',operation:'UserTweets',pageUrl:'https://x.com/alice'},
    capturedAt:new Date().toISOString(),data:{data:{user:{result:{new_timeline_shape:{}}}}}});
  assert.equal(result.ok,false);
  assert.match(result.error,/instructions/);
  assert.equal(h.local['capture:1:posts'],undefined);
});

test('reload restores active same-user capture; stopped and other-user pages stay off',async()=>{
  const h=workerHarness();
  const start=await h.send({type:'CAPTURE_START',pageUrl:'https://x.com/alice'});
  const resumed=await h.send({type:'CAPTURE_RESTORE',pageUrl:'https://x.com/alice',reload:true});
  assert.ok(resumed.session);assert.notEqual(resumed.session.token,start.session.token);
  assert.equal((await h.save(start.session.token)).ignored,true);
  assert.equal((await h.save(resumed.session.token)).ok,true);
  await h.send({type:'CAPTURE_STOP'});
  assert.equal((await h.send({type:'CAPTURE_RESTORE',pageUrl:'https://x.com/alice',reload:true})).session,null);
  await h.send({type:'CAPTURE_START',pageUrl:'https://x.com/alice'});
  assert.equal((await h.send({type:'CAPTURE_RESTORE',pageUrl:'https://x.com/bob',reload:true})).session,null);
  await h.send({type:'CAPTURE_START',pageUrl:'https://x.com/alice'});
  assert.equal((await h.send({type:'CAPTURE_RESTORE',pageUrl:'https://x.com/alice',reload:false})).session,null);
});

test('startup responses wait for restore and are discarded when initial capture is off',async()=>{
  for (const resume of [true,false]) {
    let handler;
    const sent=[];
    class XHR {open(){} send(){} addEventListener(type,fn){this.listener=fn;}}
    const ctx=vm.createContext({URL,Date,console,XMLHttpRequest:XHR,location:{href:'https://x.com/alice',origin:'https://x.com'},
      fetch:async()=>({ok:true,clone:()=>({json:async()=>({data:{}})})}),
      addEventListener:(type,fn)=>{if(type==='message') handler=fn;},postMessage:m=>sent.push(m)});
    ctx.window=ctx;
    vm.runInContext(fs.readFileSync('src/collector/core.js','utf8'),ctx);
    vm.runInContext(fs.readFileSync('src/collector/network.js','utf8'),ctx);
    ctx.dispatch=handler;
    const dispatch=session=>{
      ctx.value=session;
      vm.runInContext("dispatch({source:window,origin:location.origin,data:{channel:'X_FOLLOW_CAPTURE_V1',type:'CONTROL',session:value}})",ctx);
    };
    vm.runInContext("dispatch({source:window,origin:location.origin,data:{channel:'X_FOLLOW_CAPTURE_V1',type:'READY'}})",ctx);
    const api='https://x.com/i/api/graphql/h/UserTweets?variables=%7B%22userId%22%3A%221%22%7D';
    await ctx.fetch(api);
    const xhr=new ctx.XMLHttpRequest();xhr.open('GET',api);xhr.send();
    xhr.status=200;xhr.responseType='json';xhr.response={data:{}};xhr.listener();
    await tick();
    assert.equal(sent.filter(m=>m.type==='RESPONSE').length,0);
    dispatch(resume?{token:'restored',handle:'alice'}:null);
    if(!resume) dispatch({token:'later-start',handle:'alice'});
    await tick();
    const responses=sent.filter(m=>m.type==='RESPONSE');
    assert.equal(responses.length,resume?2:0);
    if(resume) assert.ok(responses.every(m=>m.captureToken==='restored'));
  }
});

test('HTTP 429 is a request warning, preserves saved data and capture session, and clears after success',async()=>{
  const h=workerHarness();
  const start=await h.send({type:'CAPTURE_START',pageUrl:'https://x.com/alice'});
  await h.save(start.session.token);
  const before=JSON.stringify(h.local['capture:1:posts']);
  const result=await h.send({type:'CAPTURE_SAVE',captureToken:start.session.token,
    context:{userId:'1',handle:'alice',tab:'posts',operation:'UserTweets',pageUrl:'https://x.com/alice'},
    capturedAt:new Date().toISOString(),data:{httpStatus:429,errors:[{message:'时间线请求失败：HTTP 429'}]}});
  assert.equal(result.ok,true);assert.equal(result.warning.kind,'rate_limit');
  assert.equal(h.local.captureError.kind,'rate_limit');
  assert.equal(JSON.stringify(h.local['capture:1:posts']),before);
  assert.equal((await h.send({type:'CAPTURE_STATUS'})).session.token,start.session.token);
  await h.save(start.session.token);assert.equal(h.local.captureError,null);
});
