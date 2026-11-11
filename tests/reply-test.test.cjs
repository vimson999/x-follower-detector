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
 assert.equal(c.XReplyTest.searchQuery('https://x.com/search?q=%E5%87%BA%E6%91%8A&src=typed_query'),'出摊');
 assert.equal(c.XReplyTest.searchQuery('https://x.com/search?q=出摊&f=live'),'出摊');
 assert.equal(c.XReplyTest.searchQuery('https://x.com/search?q=%20%20'),null);
 assert.equal(c.XReplyTest.searchQuery('https://x.com/home'),null);
});
test('local pool contains eight hundred distinct replies and excludes choices already used in this batch',async()=>{
 const c=vm.createContext({URL});vm.runInContext(fs.readFileSync('src/reply/core.js','utf8'),c);
 assert.equal(c.XReplyTest.replyPool.length,800);assert.equal(new Set(c.XReplyTest.replyPool).size,800);
 assert.equal(c.XReplyTest.hostReplyPool.length,800);assert.equal(new Set(c.XReplyTest.hostReplyPool).size,800);
 for(const item of c.XReplyTest.hostReplyPool) assert.ok(item.length>=10 && item.length<=20 && !item.includes('回关'),item);
 const used=[];
 for(let i=0;i<800;i++) {
   const chosen=await c.XReplyTest.requestReply({id:'123',text:'hello'},{usedReplies:used,random:()=>0});
   assert.ok(c.XReplyTest.replyPool.includes(chosen.reply));assert.ok(!used.includes(chosen.reply));
   assert.equal(chosen.poolSize,800);used.push(chosen.reply);
 }
 const hostChosen=await c.XReplyTest.requestReply({id:'123',text:'hello'},{mode:'host',random:()=>0});
 assert.equal(hostChosen.reply,c.XReplyTest.hostReplyPool[0]);
 assert.equal(hostChosen.source,'host_pool');
 assert.equal((await c.XReplyTest.requestReply({id:'123',text:'hello'},{random:()=>0.999999})).reply,c.XReplyTest.replyPool[799]);
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
 assert.equal(c.XReplyTest.exclusionReason({id:'5',authorHandle:'other'},'tester',{'99':{parentId:'5',account:'tester'}},{}),'already_processed');
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
test('textOf extracts Twemoji img alt attributes and normalizes zero-width and non-breaking spaces',()=>{
 const c=vm.createContext({URL});vm.runInContext(fs.readFileSync('src/reply/core.js','utf8'),c);
 for(const item of c.XReplyTest.replyPool) assert.ok(item.length>=20 && item.length<=40,item);
 const tree={childNodes:[
   {nodeType:3,nodeValue:'悄悄在评论区种下一个我'},
   {nodeType:1,tagName:'IMG',getAttribute:k=>k==='alt'?'🌱':null,childNodes:[]},
   {nodeType:3,nodeValue:'\u00a0欢迎关注，以后你发推我带水壶支援！\u200b'},
   {nodeType:1,tagName:'DIV',childNodes:[{nodeType:1,tagName:'BR',childNodes:[]}]}
 ]};
 assert.equal(c.XReplyTest.textOf(tree),c.XReplyTest.replyPool[6]);
 assert.equal(c.XReplyTest.textOf({childNodes:[{nodeType:1,tagName:'BR',childNodes:[]},{nodeType:3,nodeValue:'\u200b'}]}),'');
});
test('targeted thread lists are cleaned and host mode uses hostReplyPool',async()=>{
 const c=vm.createContext({URL});vm.runInContext(fs.readFileSync('src/reply/core.js','utf8'),c);
 const url='https://x.com/vimson999/status/2117951640867365069';
 assert.equal(c.XReplyTest.isTargetedThread(url),false);
 assert.equal(c.XReplyTest.resolveTargetedKey(url,[]),null);
 assert.equal(Object.keys(c.XReplyTest.targetedThreads).length,0);
 const hostRes=await c.XReplyTest.requestReply({id:'101',authorHandle:'friend',text:'早安呀'},{mode:'host'});
 assert.equal(hostRes.source,'host_pool');
 assert.equal(c.XReplyTest.hostReplyPool.includes(hostRes.reply),true);
});

test('GEMINI_GENERATE_REPLY rejects duplicate/spam responses and retries until unique',async()=>{
 let listener;
 const store={
   geminiApiKey:'test-mock-api-key',
   geminiRecentReplies:['这就把摊支起来了']
 };
 let fetchCallCount=0;
 const mockResponses=[
   {candidates:[{content:{parts:[{text:'混个脸熟'}]}}]},
   {candidates:[{content:{parts:[{text:'这就把摊支起来了'}]}}]},
   {candidates:[{content:{parts:[{text:'刚好刷到 冒个泡'}]}}]}
 ];

 const fetch=async(url,opts)=>{
   fetchCallCount++;
   const resBody=mockResponses.shift() || {candidates:[{content:{parts:[{text:'随手占个座'}]}}]};
   return {
     ok:true,
     status:200,
     json:async()=>resBody
   };
 };

 const chrome={
   runtime:{id:'ext',onMessage:{addListener:fn=>listener=fn}},
   storage:{
     local:{
       get:async k=>(typeof k==='string'?{[k]:structuredClone(store[k])}:structuredClone(store)),
       set:async o=>Object.assign(store,structuredClone(o))
     }
   }
 };

 const c=vm.createContext({chrome,Date,fetch,AbortController,setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync('src/reply/background.js','utf8'),c);

 const res=await new Promise(resolve=>{
   listener({
     type:'GEMINI_GENERATE_REPLY',
     mode:'visit',
     commentText:'蓝V活人求互关',
     commentAuthor:'tester'
   },{id:'ext'},resolve);
 });

 assert.equal(res.ok,true);
 assert.equal(res.reply,'刚好刷到 冒个泡');
 assert.equal(fetchCallCount,3);
 assert.ok(store.geminiRecentReplies.includes('刚好刷到 冒个泡'));
});
