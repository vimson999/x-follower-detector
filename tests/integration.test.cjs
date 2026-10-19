const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
test('fetch and XHR capture request-time owner/tab without consuming page responses', async () => {
  let resolveFetch;
  const sent = [], listeners = {};
  class XHR {
    open() {} send() {} addEventListener(type, fn) { this.listener = fn; }
  }
  const location = { href:'https://x.com/alice', origin:'https://x.com' };
  const ctx = vm.createContext({ URL, Date, console, location, XMLHttpRequest: XHR,
    fetch: () => new Promise(r => { resolveFetch = r; }),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    postMessage: message => sent.push(message) });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync('src/collector/core.js','utf8'), ctx);
  vm.runInContext(fs.readFileSync('src/collector/network.js','utf8'), ctx);
  ctx.dispatchMessage = listeners.message;
  vm.runInContext("dispatchMessage({source:window,origin:location.origin,data:{channel:'X_FOLLOW_CAPTURE_V1',type:'READY'}});dispatchMessage({source:window,origin:location.origin,data:{channel:'X_FOLLOW_CAPTURE_V1',type:'CONTROL',session:{token:'test',handle:'alice',tab:'posts'}}})", ctx);
  const api = 'https://x.com/i/api/graphql/h/UserTweets?variables=%7B%22userId%22%3A%221%22%7D';
  const pending = ctx.fetch(api);
  location.href = 'https://x.com/bob/with_replies';
  let clones = 0;
  const response = { ok:true, clone: () => { clones++; return { json:async()=>({data:{}}) }; } };
  resolveFetch(response);
  assert.equal(await pending, response);
  await tick();
  const capture = sent.find(m => m.type === 'RESPONSE');
  assert.equal(capture.context.handle, 'alice');
  assert.equal(capture.context.tab, 'posts');
  assert.equal(clones, 1);
  location.href = 'https://x.com/alice';
  const xhr = new ctx.XMLHttpRequest();
  xhr.open('GET', api); xhr.send();
  location.href = 'https://x.com/bob';
  xhr.status = 200; xhr.responseType = ''; xhr.responseText = '{"data":{}}'; xhr.listener();
  assert.equal(sent.filter(m => m.type === 'RESPONSE').length, 2);
  assert.equal(sent.filter(m => m.type === 'RESPONSE')[1].context.handle, 'alice');
});
test('worker serializes concurrent writes and reports storage failures', async () => {
  const store = {}; const session = {}; let listener;
  const chrome = { runtime: { id:'extension', onMessage:{ addListener:fn => {listener=fn;} } }, storage:{ local:{
    get:async key => { await tick(); return {[key]:store[key]}; },
    set:async obj => { await tick(); Object.assign(store,obj); }
  },session:{get:async key=>({[key]:session[key]}),set:async obj=>Object.assign(session,obj)} } };
  const ctx = vm.createContext({ URL, Date, console, chrome });
  ctx.importScripts = () => vm.runInContext(fs.readFileSync('src/collector/core.js','utf8'), ctx);
  vm.runInContext(fs.readFileSync('src/collector/background.js','utf8'), ctx);
  const batch = id => ({owner:{id:'1',handle:'alice',name:null},tab:'posts',capturedAt:'2026-10-19T10:00:00.000Z',source:{operation:'UserTweets'},items:[{id,metrics:{likes:1}}]});
  const started = await new Promise(resolve=>listener({type:'CAPTURE_START',pageUrl:'https://x.com/alice'},{id:'extension',url:'https://x.com/alice',tab:{id:1}},resolve));
  const send = b => new Promise(resolve => listener({type:'CAPTURE_SAVE',captureToken:started.session.token,
    context:{userId:'1',handle:'alice',tab:'posts',operation:'UserTweets',pageUrl:'https://x.com/alice'},capturedAt:b.capturedAt,
    data:{data:{user:{result:{timeline_v2:{timeline:{instructions:[{entries:b.items.map(item=>({content:{itemContent:{tweet_results:{result:{rest_id:item.id,legacy:{favorite_count:1}}}}}}))}]}}}}}}
  },{id:'extension',url:'https://x.com/alice',tab:{id:1}},resolve));
  const responses = await Promise.all([send(batch('100')),send(batch('101'))]);
  assert.ok(responses.every(r => r.ok));
  assert.equal(Object.keys(store['capture:1:posts'].items).length, 2);
  assert.equal(store.captureIndex['capture:1:posts'].count, 2);
  chrome.storage.local.set = async () => {throw Error('disk full');};
  assert.equal((await send(batch('102'))).ok, false);
});
test('POST Request clones body and captures original route; reused XHR ignores stale listener', async () => {
  const messages = []; let handler;
  class XHR {
    constructor() {this.listeners=[];}
    open() {} send() {}
    addEventListener(type, fn) { if (type === 'load') this.listeners.push(fn); }
  }
  const ctx=vm.createContext({URL,Date,console,Request,XMLHttpRequest:XHR,
    location:{href:'https://x.com/alice',origin:'https://x.com'},
    fetch:async()=>({ok:true,clone:()=>({json:async()=>({data:{}})})}),
    addEventListener:(type,fn)=>{if(type==='message')handler=fn;},postMessage:m=>messages.push(m)});
  ctx.window=ctx;
  vm.runInContext(fs.readFileSync('src/collector/core.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync('src/collector/network.js','utf8'),ctx);
  ctx.dispatchMessage=handler;
  vm.runInContext("dispatchMessage({source:window,origin:location.origin,data:{channel:'X_FOLLOW_CAPTURE_V1',type:'READY'}});dispatchMessage({source:window,origin:location.origin,data:{channel:'X_FOLLOW_CAPTURE_V1',type:'CONTROL',session:{token:'test',handle:'alice',tab:'posts'}}})",ctx);
  const req=new Request('https://x.com/i/api/graphql/hash/UserTweets',{method:'POST',body:JSON.stringify({variables:{userId:'1'}})});
  await ctx.fetch(req);
  ctx.location.href='https://x.com/bob';
  await new Promise(r=>setTimeout(r,30));
  assert.equal(req.bodyUsed,false);
  assert.equal(messages.filter(m=>m.type==='RESPONSE')[0]?.context.handle,'alice');
  const xhr=new ctx.XMLHttpRequest();
  const url=id=>`https://x.com/i/api/graphql/h/UserTweets?variables=${encodeURIComponent(JSON.stringify({userId:id}))}`;
  ctx.location.href='https://x.com/alice';xhr.open('GET',url('1'));xhr.send();
  ctx.location.href='https://x.com/bob';vm.runInContext("dispatchMessage({source:window,origin:location.origin,data:{channel:'X_FOLLOW_CAPTURE_V1',type:'CONTROL',session:{token:'bob',handle:'bob',tab:'posts'}}})",ctx);xhr.open('GET',url('2'));xhr.send();
  xhr.status=200;xhr.responseType='json';xhr.response={data:{}};
  xhr.listeners.forEach(fn=>fn());
  const xhrMessages=messages.filter(m=>m.type==='RESPONSE').slice(1);
  assert.equal(xhrMessages.length,1);
  assert.equal(xhrMessages[0].context.handle,'bob');
});
