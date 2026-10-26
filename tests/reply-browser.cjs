const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path'), assert=require('node:assert/strict');
(async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'x-reply-test-'));let context;
 try{
  const root=path.resolve(__dirname,'..');
  context=await chromium.launchPersistentContext(profile,{headless:true,ignoreDefaultArgs:['--disable-extensions'],executablePath:process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
  await context.route('https://x.com/**',r=>r.request().url().includes('/graphql/')?r.fulfill({status:200,json:{errors:[{code:88}]}}):r.fulfill({contentType:'text/html',body:'<!doctype html><html><title>Reply test fixture</title><body><main></main></body></html>'}));
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ext=new URL(worker.url()).host;
  const page=await context.newPage();await page.goto('https://x.com/home');
  await page.evaluate(draftMode=>{
   window.published=0;window.inputEvents=0;window.sentTexts=[];
   const profile=document.createElement('a');profile.dataset.testid='AppTabBar_Profile_Link';profile.href='/tester';document.body.appendChild(profile);
   const home=document.createElement('a');home.dataset.testid='AppTabBar_Home_Link';home.href='/home';home.textContent='Home';document.body.appendChild(home);
   const showHome=()=>{
     document.querySelector('main').innerHTML='<div data-testid="placementTracking"><article data-testid="tweet"><a href="/ad/status/999"><time>now</time></a><div data-testid="tweetText">Ad to skip</div></article></div><article data-testid="tweet"><a href="/alice/status/123"><time datetime="2026-10-26T03:00:00Z">now</time></a><div data-testid="tweetText">Home post text</div></article>';
     document.querySelector('a[href="/alice/status/123"]').onclick=e=>{
       e.preventDefault();fetch('/i/api/graphql/fixture/TweetDetail?secret=NETWORK_SECRET');history.pushState({},'', '/alice/status/123');
       setTimeout(()=>{
         document.querySelector('main').innerHTML='<article data-testid="tweet"><a href="/alice/status/123"><time>now</time></a><div data-testid="tweetText">Full detail post text</div></article><div role="textbox" data-testid="tweetTextarea_0" contenteditable="true"></div><button data-testid="tweetButtonInline" disabled>回复</button>';
         const editor=document.querySelector('[contenteditable]'),button=document.querySelector('button');
         editor.oninput=e=>{window.inputEvents++;if(draftMode && e.data)editor.textContent+=e.data;button.disabled=!editor.textContent;};
         if(draftMode)editor.onpaste=e=>{e.preventDefault();editor.textContent=e.clipboardData.getData('text/plain');window.inputEvents++;button.disabled=!editor.textContent;};
         button.onclick=()=>{
           fetch('/i/api/graphql/fixture/CreateTweet?secret=NETWORK_SECRET',{method:'POST',headers:{authorization:'HEADER_SECRET'},body:'REQUEST_BODY_SECRET'});
           const replyText=editor.textContent;window.sentTexts.push(replyText);window.published++;editor.textContent='';button.disabled=true;
           const reply=document.createElement('article');reply.dataset.testid='tweet';reply.innerHTML='<a href="/tester/status/456"><time>now</time></a><div data-testid="tweetText"></div>';reply.querySelector('div').textContent=replyText;document.querySelector('main').appendChild(reply);
         };
       },200);
     };
   };
   home.onclick=e=>{e.preventDefault();history.pushState({},'', '/home');showHome();};showHome();
  },process.env.DRAFT_DUPLICATES==='1');
  await page.evaluate(()=>{
    const script=document.createElement('script');script.textContent='void "DOM_SCRIPT_SECRET"';document.body.appendChild(script);
    const input=document.createElement('input');input.type='password';input.value='PASSWORD_SECRET';input.setAttribute('value','PASSWORD_SECRET');document.body.appendChild(input);
    document.querySelector('main').setAttribute('data-auth-token','ATTRIBUTE_SECRET');
  });
  const popup=await context.newPage();await popup.setViewportSize({width:380,height:600});await popup.goto(`chrome-extension://${ext}/src/popup/index.html`);
  const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://x.com/home'}))[0].id);
  await popup.evaluate(id=>{chrome.tabs.query=async()=>[await chrome.tabs.get(id)];},tabId);
  // Accelerate only the wait scheduler in this isolated test profile. Requested
  // production delays stay unchanged and are asserted in the exported bundle.
  await worker.evaluate(async id=>chrome.scripting.executeScript({target:{tabId:id},world:'ISOLATED',func:()=>{
    XReplyTest.sleep=async(ms,check)=>{check();await new Promise(r=>setTimeout(r,15));check();};
  }}),tabId);
  await popup.getByRole('button',{name:'操作录制',exact:true}).click();
  const entryBox=await popup.locator('#btn-reply-test').boundingBox();
  assert.ok(entryBox.y>=0 && entryBox.y+entryBox.height<=600,'reply test entry must be visible without scrolling');
  assert.equal(await popup.locator('#view-recorder').evaluate(el=>getComputedStyle(el).overflowY),'auto');
  await popup.screenshot({path:path.join(os.tmpdir(),'x-reply-entry.png')});
  await popup.locator('#btn-reply-test').click();
  await popup.locator('#reply-test-status').filter({hasText:'测试完成'}).waitFor();
  assert.equal(page.url(),'https://x.com/home');
  const sentTexts=await page.evaluate(()=>window.sentTexts);
  assert.equal(sentTexts.length,1);
  assert.ok(await page.evaluate(()=>window.inputEvents)>0);
  assert.equal(await page.evaluate(()=>window.published),1);
  assert.equal(await page.locator('[contenteditable]').count(),0);
  assert.match(await popup.locator('#reply-test-preview').innerText(),/Full detail post text/);
  await page.waitForTimeout(500);
  const completed=await worker.evaluate(async()=> (await chrome.storage.local.get('replyTestState')).replyTestState);
  assert.equal(completed.schemaVersion,2);
  assert.equal(completed.networkObserverReady,true);
  assert.ok(completed.snapshots.some(s=>s.stage==='reading' && s.dom.html.includes('Home post text')));
  assert.ok(completed.snapshots.some(s=>s.stage==='publishing' && s.locators.publishButtons.count===1));
  assert.ok(completed.network.some(e=>e.operation==='CreateTweet' && e.status===200));
  assert.ok(completed.snapshots.some(s=>s.stage==='confirming'));
  assert.ok(sentTexts.includes(completed.reply));
  assert.equal(completed.diagnostics.replyChoice.poolSize,300);
  assert.equal(completed.clicked,true);
  assert.equal(completed.completedCount,1);
  for(const stage of ['reading_wait','prepublish_wait']) assert.ok(completed.results[0].delays[stage]>=5000 && completed.results[0].delays[stage]<=10000);
  assert.ok(completed.results[0].delays.postpublish_wait>=10000 && completed.results[0].delays.postpublish_wait<=20000);
  assert.ok(completed.trace.some(t=>t.stage==='home_ready'));
  assert.equal(completed.diagnostics.actualLength,completed.reply.length);
  assert.equal(completed.diagnostics.fillMethod,process.env.DRAFT_DUPLICATES==='1'?'paste':'native');
  assert.ok(completed.trace.some(t=>t.stage==='confirming'));
  // Repeat must retain the existing draft and never publish it.
  await popup.locator('#btn-reply-test').click();
  await popup.locator('#reply-test-status').filter({hasText:'已提交过'}).waitFor();
  assert.equal(await page.locator('[contenteditable]').count(),0);
  assert.equal(await page.evaluate(()=>window.published),1);
  await page.evaluate(()=>{
    history.pushState({},'', '/home');
    document.querySelector('main').innerHTML='<article data-testid="tweet"><a href="/alice/status/777"><time>now</time></a></article><article data-testid="tweet"><a href="/alice/status/888"><time>now</time></a><div data-testid="tweetText">Second post must not be selected</div></article>';
  });
  await popup.locator('#btn-reply-test').click();
  await popup.locator('#reply-test-status').filter({hasText:'第一条帖子无法'}).waitFor();
  assert.equal(page.url(),'https://x.com/home');
  assert.equal(await page.evaluate(()=>window.published),1);
  await page.evaluate(()=>{
    history.pushState({},'', '/alice/status/777');
    document.querySelector('main').innerHTML='<article data-testid="tweet"><a href="/alice/status/777"><time>now</time></a><div data-testid="tweetText">Different post</div></article><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0">Existing draft</div><button data-testid="tweetButtonInline">回复</button>';
  });
  await popup.locator('#btn-reply-test').click();
  await popup.locator('#reply-test-status').filter({hasText:'已有草稿'}).waitFor();
  assert.equal(await page.locator('[contenteditable]').innerText(),'Existing draft');
  assert.equal(await page.evaluate(()=>window.published),1);
  await page.evaluate(()=>{
    const editor=document.querySelector('[contenteditable]');editor.textContent='';
    editor.onpaste=e=>{e.preventDefault();editor.textContent='哈哈哈哈哈哈';};
  });
  await popup.locator('#btn-reply-test').click();
  await popup.locator('#reply-test-status').filter({hasText:/实际 6 字/}).waitFor();
  const blocked=await worker.evaluate(async()=> (await chrome.storage.local.get('replyTestState')).replyTestState);
  assert.ok(blocked.snapshots.some(s=>s.stage==='error' && s.scope==='body'));
  assert.ok(blocked.exceptions.some(e=>e.type==='test_error'));
  assert.ok(!JSON.stringify(blocked).includes('PASSWORD_SECRET'));
  assert.ok(!JSON.stringify(blocked).includes('DOM_SCRIPT_SECRET'));
  assert.ok(!JSON.stringify(completed).includes('NETWORK_SECRET'));
  assert.ok(!JSON.stringify(completed).includes('HEADER_SECRET'));
  assert.ok(!JSON.stringify(completed).includes('REQUEST_BODY_SECRET'));
  assert.ok(!JSON.stringify(completed).includes('ATTRIBUTE_SECRET'));
  assert.equal(blocked.clicked,false);assert.equal(blocked.failedStage,'filling');
  assert.equal(await page.evaluate(()=>window.published),1);
  assert.match(await page.locator('[data-x-reply-test-status]').innerText(),/未点击回复/);
  const downloadPromise=popup.waitForEvent('download');
  await popup.locator('#btn-reply-diagnostics').click();
  const download=await downloadPromise;
  const bundle=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(bundle.runId,blocked.runId);
  assert.ok(bundle.snapshots.length>0);
  assert.equal(bundle.failedStage,'filling');
  assert.ok(bundle.exportedAt);
  await page.evaluate(()=>{
    history.pushState({},'', '/tester/status/999');
    document.querySelector('main').innerHTML='<article data-testid="tweet"><a href="/TESTER/status/999"><time>now</time></a><div data-testid="tweetText">My own post</div></article>';
  });
  await popup.locator('#btn-reply-test').click();
  await popup.locator('#reply-test-status').filter({hasText:'不会回复自己'}).waitFor();
  assert.equal(await page.evaluate(()=>window.published),1);
  console.log('PASS: diagnostic DOM snapshots/network/error/export/redaction,  skip ad, enter exact post, read delayed detail, mock reply, native editor input, publish exactly once, verify reply, reject duplicate');
 }finally{if(context) await context.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
