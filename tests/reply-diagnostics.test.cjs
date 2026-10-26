const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
test('network diagnostic observes only the active test, redacts query/header/body, returns original response',async()=>{
 let handler;const sent=[];
 class XHR {open(){} send(){} addEventListener(){}}
 const response={status:429};
 const ctx=vm.createContext({URL,Date,XMLHttpRequest:XHR,location:{href:'https://x.com/home',origin:'https://x.com'},fetch:async()=>response,
   addEventListener:(type,fn)=>{if(type==='message')handler=fn;},postMessage:m=>sent.push(m)});ctx.window=ctx;
 vm.runInContext(fs.readFileSync('src/reply/network.js','utf8'),ctx);
 ctx.dispatch=handler;
 const control=type=>vm.runInContext(`dispatch({source:window,origin:location.origin,data:{channel:'X_REPLY_DIAGNOSTICS_V1',type:'${type}',runId:'test-run'}})`,ctx);
 const url='https://x.com/i/api/graphql/h/CreateTweet?secret=AUTH_SECRET';
 await ctx.fetch(url);assert.equal(sent.length,0);
 control('START');
 assert.equal(await ctx.fetch(url,{method:'POST',headers:{authorization:'AUTH_SECRET'},body:'PRIVATE_BODY'}),response);
 await new Promise(r=>setImmediate(r));
 const records=sent.filter(m=>m.type==='NETWORK');assert.equal(records.length,2);
 assert.equal(records[1].event.status,429);assert.equal(records[1].event.operation,'CreateTweet');
 assert.ok(!JSON.stringify(records).includes('AUTH_SECRET'));assert.ok(!JSON.stringify(records).includes('PRIVATE_BODY'));
 const count=sent.length;control('STOP');await ctx.fetch(url);assert.equal(sent.length,count);
});
