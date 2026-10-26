const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const tick=()=>new Promise(r=>setImmediate(r));
function harness() {
  let listener, saved=null, seq=0, scrolls=0;
  const timers=new Map(), events={};
  const location={href:'https://x.com/alice',origin:'https://x.com'};
  const ctx=vm.createContext({console,location,innerHeight:1000,
    setInterval:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq;},clearInterval:id=>timers.delete(id),
    scrollBy:()=>scrolls++,postMessage(){},addEventListener:(name,fn)=>events[name]=fn,
    chrome:{runtime:{onMessage:{addListener:fn=>listener=fn},sendMessage:async m=>{
      if(m.type==='CAPTURE_START') saved={token:'t',handle:'alice',tab:'posts',autoScroll:m.autoScroll===true};
      if(m.type==='CAPTURE_STOP')saved=null;
      return {ok:true,session:saved};
    }},storage:{onChanged:{addListener(){}},local:{set:async()=>{}}}}});ctx.window=ctx;
  vm.runInContext(fs.readFileSync('src/collector/bridge.js','utf8'),ctx);
  return {send:m=>new Promise(resolve=>{if(!listener(m,{},resolve))resolve({error:'unhandled'});}),location,events,
    scroll:()=>{for(const t of [...timers.values()])if(t.ms===2500)t.fn();},count:()=>scrolls,
    activeTimers:()=>[...timers.values()].filter(t=>t.ms===2500).length};
}
test('capture and scrolling have independent start and stop controls',async()=>{
  const h=harness();await tick();
  await h.send({type:'CAPTURE_START'});h.scroll();assert.equal(h.count(),0);
  await h.send({type:'SCROLL_START'});h.scroll();assert.equal(h.count(),1);
  await h.send({type:'CAPTURE_STATUS'});assert.equal(h.activeTimers(),1);
  await h.send({type:'SCROLL_STOP'});h.scroll();assert.equal(h.count(),1);
  assert.ok((await h.send({type:'CAPTURE_STATUS'})).session);
  await h.send({type:'SCROLL_START'});
  await h.send({type:'CAPTURE_STOP'});h.scroll();assert.equal(h.count(),2);
  const state=await h.send({type:'CAPTURE_STATUS'});
  assert.equal(state.session,null);assert.equal(state.scrolling,true);
  await h.send({type:'SCROLL_STOP'});assert.equal(h.activeTimers(),0);
});
test('scrolling survives same-user tabs but stops on other user and page exit',async()=>{
  const h=harness();await tick();
  await h.send({type:'SCROLL_START'});
  h.location.href='https://x.com/alice/with_replies';h.scroll();assert.equal(h.count(),1);
  h.location.href='https://x.com/bob';h.scroll();assert.equal(h.count(),1);
  assert.equal(h.activeTimers(),0);
  h.location.href='https://x.com/alice';await h.send({type:'SCROLL_START'});h.events.pagehide();h.scroll();assert.equal(h.count(),1);
});
