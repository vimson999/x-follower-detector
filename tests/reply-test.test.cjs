const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('post URLs require numeric IDs and keep their author, excluding undefined links',()=>{
 const c=vm.createContext({URL});vm.runInContext(fs.readFileSync('src/reply/core.js','utf8'),c);
 assert.equal(c.XReplyTest.postUrl('https://x.com/alice/status/undefined'),null);
 assert.equal(c.XReplyTest.postUrl('https://x.com/TeStEr/status/999'),'https://x.com/tester/status/999');
 assert.equal(c.XReplyTest.postUrl('https://evil.test/alice/status/123'),null);
 assert.equal(c.XReplyTest.postUrl('/alice/status/123?ref=secret','https://x.com/home'),'https://x.com/alice/status/123');
});
test('local pool contains three hundred distinct replies and excludes choices already used in this batch',async()=>{
 const c=vm.createContext({URL});vm.runInContext(fs.readFileSync('src/reply/core.js','utf8'),c);
 assert.equal(c.XReplyTest.replyPool.length,300);assert.equal(new Set(c.XReplyTest.replyPool).size,300);
 const used=[];
 for(let i=0;i<300;i++) {
   const chosen=await c.XReplyTest.requestReply({id:'123',text:'hello'},{usedReplies:used,random:()=>0});
   assert.ok(c.XReplyTest.replyPool.includes(chosen.reply));assert.ok(!used.includes(chosen.reply));
   assert.equal(chosen.poolSize,300);used.push(chosen.reply);
 }
 assert.equal((await c.XReplyTest.requestReply({id:'123',text:'hello'},{random:()=>0.999999})).reply,c.XReplyTest.replyPool[299]);
 await assert.rejects(()=>c.XReplyTest.requestReply({id:'123',text:''}));
});
test('publication reservation serializes tabs and rejects repeated claims',async()=>{
 let listener;const store={};
 const chrome={runtime:{id:'ext',onMessage:{addListener:fn=>listener=fn}},storage:{local:{get:async key=>({[key]:structuredClone(store[key])}),set:async o=>Object.assign(store,structuredClone(o))}}};
 const c=vm.createContext({chrome,Date});vm.runInContext(fs.readFileSync('src/reply/background.js','utf8'),c);
 const claim=tab=>new Promise(resolve=>listener({type:'REPLY_TEST_CLAIM',postId:'123',runId:'run'+tab},{id:'ext',tab:{id:tab},url:'https://x.com/home'},resolve));
 const results=await Promise.all([claim(1),claim(2)]);
 assert.equal(results.filter(r=>r.ok).length,1);
 assert.equal((await claim(1)).ok,false);
 const winner=results[0].ok?1:2;
 const confirm=tab=>new Promise(resolve=>listener({type:'REPLY_TEST_CONFIRMED',postId:'123',replyId:'456',account:'tester',runId:'run'+winner},{id:'ext',tab:{id:tab},url:'https://x.com/home'},resolve));
 assert.equal((await confirm(winner===1?2:1)).ok,false);
 assert.equal((await confirm(winner)).ok,true);
 assert.equal(store.replyTestOwnReplies['456'].parentId,'123');
 assert.equal(store.replyTestOwnReplies['456'].account,'tester');

});

test('reading and pre-submit waits are uniformly bounded at 5–10 seconds; return wait is ten seconds',()=>{
 const c=vm.createContext({URL});vm.runInContext(fs.readFileSync('src/reply/core.js','utf8'),c);
 assert.equal(c.XReplyTest.randomDelayMs(()=>0),5000);
 assert.equal(c.XReplyTest.randomDelayMs(()=>0.999999),10000);
 for(let i=0;i<100;i++){const ms=c.XReplyTest.randomDelayMs();assert.ok(ms>=5000 && ms<=10000);}
 assert.equal(c.XReplyTest.returnDelayMs,10000);
});
test('wait scheduler respects the duration and can be interrupted before submission',async()=>{
 const c=vm.createContext({URL,Date,setTimeout});vm.runInContext(fs.readFileSync('src/reply/core.js','utf8'),c);
 const started=Date.now();await c.XReplyTest.sleep(25);assert.ok(Date.now()-started>=25);
 let stopped=false;setTimeout(()=>{stopped=true;},10);
 await assert.rejects(()=>c.XReplyTest.sleep(500,()=>{if(stopped)throw Error('stopped');}),/stopped/);
});

test('candidate exclusion covers own authors, generated replies and previously processed posts',()=>{
 const c=vm.createContext({URL});vm.runInContext(fs.readFileSync('src/reply/core.js','utf8'),c);
 assert.equal(c.XReplyTest.exclusionReason({id:'1',authorHandle:'TeStEr'},'tester',{},{}),'own_author');
 assert.equal(c.XReplyTest.exclusionReason({id:'2',authorHandle:'other'},'tester',{'2':{}},{}),'own_reply');
 assert.equal(c.XReplyTest.exclusionReason({id:'3',authorHandle:'other'},'tester',{}, {'3':{}}),'already_processed');
 assert.equal(c.XReplyTest.exclusionReason({id:'4',authorHandle:'other'},'tester',{},{}),null);
});
test('configurable reply count and random interval validate without silently fixing invalid values',()=>{
 const c=vm.createContext({URL});vm.runInContext(fs.readFileSync('src/reply/core.js','utf8'),c);
 const settings=c.XReplyTest.validateSettings({count:5,intervalMinSec:20,intervalMaxSec:40});
 assert.equal(settings.count,5);assert.equal(settings.intervalMaxSec,40);
 assert.equal(c.XReplyTest.randomBetweenMs(20000,40000,()=>0),20000);
 assert.equal(c.XReplyTest.randomBetweenMs(20000,40000,()=>0.999999),40000);
 assert.equal(c.XReplyTest.randomBetweenMs(30000,30000),30000);
 for(const value of [{count:0},{count:51},{count:2.5},{count:2,intervalMinSec:40,intervalMaxSec:20},{count:2,intervalMinSec:-1,intervalMaxSec:20},{count:2,intervalMinSec:1,intervalMaxSec:Infinity}]) assert.throws(()=>c.XReplyTest.validateSettings(value));
});
