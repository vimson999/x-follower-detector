const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'x-reply-readiness-'));let context;
 try{
  const root=path.resolve(__dirname,'..');
  context=await chromium.launchPersistentContext(profile,{headless:true,ignoreDefaultArgs:['--disable-extensions'],executablePath:process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
  await context.route('https://x.com/**',r=>r.request().url().includes('/graphql/')?r.fulfill({status:403,json:{errors:[]}}):r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}));
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page=await context.newPage();
  for(const [index,mode] of ['covered','moving','offscreen','dialog','http403'].entries()){
   await page.goto(`https://x.com/alice/status/${800+index}`);
   await page.evaluate(({mode,id})=>{
    window.sent=0;window.premature=false;window.started=0;
    document.querySelector('main').innerHTML=`<a data-testid="AppTabBar_Profile_Link" href="/tester">Profile</a><a data-testid="AppTabBar_Home_Link" href="/home">Home</a><article data-testid="tweet"><a href="/alice/status/${id}"><time>now</time></a><div data-testid="tweetText">Ready fixture</div></article><div contenteditable="true" data-testid="tweetTextarea_0" style="min-height:30px"></div><button data-testid="tweetButtonInline" disabled>Reply</button>`;
    const editor=document.querySelector('[contenteditable]'),button=document.querySelector('button');
    if(mode==='offscreen')button.style.marginTop='2000px';
    editor.onpaste=e=>{
     e.preventDefault();editor.textContent=e.clipboardData.getData('text/plain');button.disabled=false;window.started=Date.now();
     if(mode==='http403')fetch('/i/api/graphql/fixture/TweetDetail');
     if(mode==='covered'||mode==='dialog'){
      const overlay=document.createElement('div');overlay.style='position:fixed;inset:0;z-index:999999;background:#ccc';
      if(mode==='dialog'){overlay.setAttribute('role','dialog');overlay.textContent='Verify your account';}
      document.body.appendChild(overlay);
     }
     if(mode==='moving'){
      let n=0;const timer=setInterval(()=>{button.style.marginLeft=`${++n%2*100}px`;window.lastMotion=Date.now();},100);
      setTimeout(()=>{clearInterval(timer);window.settled=Date.now();},1500);
     }
    };
    button.onclick=()=>{
     const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
     window.premature=(mode==='moving' && (!window.settled || Date.now()-window.lastMotion<600)) || !(hit===button || button.contains(hit));
     window.sent++;const text=editor.textContent;editor.textContent='';
     const a=document.createElement('article');a.dataset.testid='tweet';a.innerHTML=`<a href="/tester/status/${id+100}"><time>now</time></a><div data-testid="tweetText"></div>`;a.querySelector('div').textContent=text;document.querySelector('main').appendChild(a);
    };
    document.querySelector('[data-testid="AppTabBar_Home_Link"]').onclick=e=>{e.preventDefault();history.pushState({},'','/home');};
   },{mode,id:800+index});
   const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://x.com/*'}))[0].id);
   await worker.evaluate(async id=>chrome.scripting.executeScript({target:{tabId:id},world:'ISOLATED',func:()=>{XReplyTest.sleep=async(ms,check)=>{check();await new Promise(r=>setTimeout(r,15));check();};}}),tabId);
   const started=await worker.evaluate(async id=>chrome.tabs.sendMessage(id,{type:'REPLY_TEST_START',tabId:id,count:1}),tabId);
   assert.ok(started.ok);
   let state;const until=Date.now()+20000;
   do{await new Promise(r=>setTimeout(r,100));state=await worker.evaluate(async()=> (await chrome.storage.local.get('replyTestState')).replyTestState);}while((state?.runId!==started.runId || state.active) && Date.now()<until);
   const result=await page.evaluate(()=>({sent:window.sent,premature:window.premature}));
   if(['covered','dialog','http403'].includes(mode)){
    assert.equal(result.sent,0,`${mode}: must not publish through overlay`);assert.equal(state.state,'error');assert.equal(state.clicked,false);
    if(mode==='http403')assert.match(state.message,/HTTP 403/);
   }else{assert.equal(state.state,'completed',JSON.stringify(state.message));assert.equal(result.sent,1);assert.equal(result.premature,false,`${mode}: must wait until reachable and stable`);}
   console.log(`PASS: ${mode}`);
  }
 }finally{if(context)await context.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
