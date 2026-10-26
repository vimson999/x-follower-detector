const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'x-reply-batch-'));let context;
 try{
  const root=path.resolve(__dirname,'..');
  context=await chromium.launchPersistentContext(profile,{headless:true,ignoreDefaultArgs:['--disable-extensions'],executablePath:process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
  await context.route('https://x.com/**',r=>r.request().url().includes('/graphql/')?r.fulfill({status:r.request().url().includes('limit=1')?429:200,json:{data:{}}}):r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}));
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');const ext=new URL(worker.url()).host;
  const page=await context.newPage();await page.goto('https://x.com/home');
  await page.evaluate(()=>{
   window.sent=[];window.actions=[];window.mode='normal';window.morePosts=false;document.body.style.minHeight='20000px';
   const profile=document.createElement('a');profile.dataset.testid='AppTabBar_Profile_Link';profile.href='/tester';document.body.appendChild(profile);
   const home=document.createElement('a');home.dataset.testid='AppTabBar_Home_Link';home.href='/home';home.textContent='Home';document.body.appendChild(home);
   window.showHome=()=>{
    const ownOriginal='<article data-testid="tweet"><a href="/TeStEr/status/900"><time>now</time></a></article>';
    const ownReplies=window.sent.map(item=>`<article data-testid="tweet"><a href="/tester/status/${100+Number(item.id)}"><time>now</time></a><div data-testid="tweetText">My earlier reply</div></article>`).join('');
    document.querySelector('main').innerHTML=ownOriginal+ownReplies+(window.morePosts?[1,2,3,4,5,6]:[1,2,3,4]).map(id=>`<article data-testid="tweet"><a href="/alice/status/${id}"><time>now</time></a><div data-testid="tweetText">Post ${id}</div></article>`).join('');
    for(const link of document.querySelectorAll('main a')) link.onclick=e=>{
     e.preventDefault();const id=link.getAttribute('href').split('/').pop();window.actions.push('open:'+id);history.pushState({},'',link.getAttribute('href'));
     fetch('/i/api/graphql/fixture/TweetDetail'+(window.mode==='rate' && id==='2'?'?limit=1':''));
     setTimeout(()=>{
      document.querySelector('main').innerHTML=`<article data-testid="tweet"><a href="/alice/status/${id}"><time>now</time></a><div data-testid="tweetText">Full post ${id}</div></article><div data-testid="tweetTextarea_0" contenteditable="true" role="textbox"></div><button data-testid="tweetButtonInline" disabled>回复</button>`;
      const editor=document.querySelector('[contenteditable]'),button=document.querySelector('button');
      editor.onpaste=e=>{e.preventDefault();editor.textContent=e.clipboardData.getData('text/plain');button.disabled=false;};
      button.onclick=()=>{
       const replyText=editor.textContent;window.sent.push({id,text:replyText});window.actions.push('publish:'+id);fetch('/i/api/graphql/fixture/CreateTweet',{method:'POST'});editor.textContent='';button.disabled=true;
       if(window.mode==='uncertain') return;
       const reply=document.createElement('article');reply.dataset.testid='tweet';reply.innerHTML=`<a href="/tester/status/${100+Number(id)}"><time>now</time></a><div data-testid="tweetText"></div>`;reply.querySelector('div').textContent=replyText;document.querySelector('main').appendChild(reply);
      };
     },60);
    };
   };
   window.addEventListener('scroll',()=>{if(location.pathname==='/home' && window.sent.length>=4 && !window.morePosts){window.morePosts=true;window.showHome();}});
   home.onclick=e=>{e.preventDefault();window.actions.push('home');history.pushState({},'', '/home');window.showHome();};window.showHome();
  });
  const popup=await context.newPage();await popup.setViewportSize({width:380,height:600});await popup.goto(`chrome-extension://${ext}/src/popup/index.html`);
  const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://x.com/home'}))[0].id);
  await popup.evaluate(id=>{chrome.tabs.query=async()=>[await chrome.tabs.get(id)];},tabId);
  await popup.getByRole('button',{name:'操作录制',exact:true}).click();
  // The injected scheduler accelerates wall time only in this temporary profile.
  // All requested production waits are still recorded and checked below.
  const inject=async block=>worker.evaluate(async({tabId,block})=>chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:block=>{
    globalThis.__blockAt=block;
    XReplyTest.sleep=async(ms,check)=>{
      do{check();await new Promise(r=>setTimeout(r,15));check();}
      while(globalThis.__blockAt==='reading' && document.querySelector('[data-x-reply-test-status]').textContent.includes('等待阅读'));
    };
  },args:[block]}),{tabId,block});
  await inject(null);
  await popup.locator('#btn-reply-test-three').click();
  await popup.locator('#reply-test-status').filter({hasText:'测试完成'}).waitFor();
  assert.equal(page.url(),'https://x.com/home');
  const sent=await page.evaluate(()=>window.sent);
  assert.deepEqual(sent.map(item=>item.id),['1','2','3']);assert.equal(new Set(sent.map(item=>item.text)).size,3);
  assert.deepEqual(await page.evaluate(()=>window.actions),['open:1','publish:1','home','open:2','publish:2','home','open:3','publish:3','home']);
  const batch=await worker.evaluate(async()=> (await chrome.storage.local.get('replyTestState')).replyTestState);
  assert.equal(batch.diagnostics.replyChoice.poolSize,300);
  assert.ok(batch.diagnostics.selection.candidates.some(c=>c.id==='900' && c.reason==='own_author'));
  assert.ok(batch.diagnostics.selection.candidates.some(c=>c.id==='101' && c.reason==='own_reply'));
  const ownSaved=await worker.evaluate(async()=> (await chrome.storage.local.get('replyTestOwnReplies')).replyTestOwnReplies);
  assert.equal(ownSaved['101'].parentId,'1');
  assert.equal(ownSaved['102'].parentId,'2');
  assert.equal(batch.batchTotal,3);assert.equal(batch.results.length,3);
  for(const result of batch.results){assert.equal(result.replyChoice.poolSize,300);assert.ok(sent.some(s=>s.text===result.reply));assert.ok(result.delays.reading_wait>=5000 && result.delays.reading_wait<=10000);assert.ok(result.delays.prepublish_wait>=5000 && result.delays.prepublish_wait<=10000);assert.ok(result.delays.postpublish_wait>=10000 && result.delays.postpublish_wait<=20000);}
  for(const i of [1,2,3]){assert.ok(batch.trace.some(t=>t.itemIndex===i && t.stage==='home_ready'));assert.ok(batch.snapshots.some(t=>t.itemIndex===i && t.stage==='publishing'));}
  assert.equal(await popup.locator('#btn-reply-test-stop').isDisabled(),true);
  async function reset(mode){
   await worker.evaluate(()=>chrome.storage.local.remove('replyTestClaims'));
   await page.evaluate(mode=>{window.mode=mode;window.sent=[];window.actions=[];window.morePosts=false;history.pushState({},'', '/home');window.showHome();},mode);
  }
  // Configure five items and a new interval, then verify persisted settings.
  await reset('normal');
  await popup.locator('#reply-test-count').fill('5');
  await popup.locator('#reply-test-interval-min').fill('25');
  await popup.locator('#reply-test-interval-max').fill('45');
  await popup.locator('#btn-reply-test-configured').click();
  await popup.locator('#reply-test-status').filter({hasText:'测试完成'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.sent.map(s=>s.id)),['1','2','3','4','5']);
  const configured=await worker.evaluate(async()=> (await chrome.storage.local.get('replyTestState')).replyTestState);
  assert.equal(configured.batchTotal,5);assert.equal(configured.results.length,5);
  assert.ok(configured.trace.some(t=>t.itemIndex===5 && t.stage==='finding_next'));
  assert.deepEqual(configured.settings,{count:5,intervalMinSec:25,intervalMaxSec:45});
  assert.ok(configured.snapshots.some(s=>s.itemIndex===5 && s.stage==='publishing'));
  for(const result of configured.results) assert.ok(result.delays.postpublish_wait>=25000 && result.delays.postpublish_wait<=45000);
  await popup.reload();
  await popup.evaluate(id=>{chrome.tabs.query=async()=>[await chrome.tabs.get(id)];},tabId);
  await popup.getByRole('button',{name:'操作录制',exact:true}).click();
  assert.equal(await popup.locator('#reply-test-count').inputValue(),'5');
  assert.equal(await popup.locator('#reply-test-interval-min').inputValue(),'25');
  assert.equal(await popup.locator('#reply-test-interval-max').inputValue(),'45');
  await popup.locator('#reply-test-interval-min').fill('50');
  await popup.locator('#btn-reply-test-configured').click();
  await popup.locator('#reply-test-status').filter({hasText:'最小值不能大于最大值'}).waitFor();
  assert.equal((await page.evaluate(()=>window.sent)).length,5);
  await popup.locator('#reply-test-interval-min').fill('25');
  // Stop during the reading wait: no filling or posting and no second target.
  await reset('normal');await inject('reading');
  await popup.locator('#btn-reply-test-three').click();
  await popup.locator('#reply-test-status').filter({hasText:'等待阅读'}).waitFor();
  assert.equal(await popup.locator('#reply-test-count').isDisabled(),true);
  assert.equal(await popup.locator('#reply-test-interval-min').isDisabled(),true);
  await popup.locator('#btn-reply-test-stop').click();
  await popup.locator('#reply-test-status').filter({hasText:'已停止测试'}).waitFor();
  assert.equal((await page.evaluate(()=>window.sent)).length,0);
  assert.equal(await page.locator('[contenteditable]').innerText(),'');
  assert.deepEqual(await page.evaluate(()=>window.actions),['open:1']);
  // Rate limiting on the second detail must preserve the first success and stop.
  await reset('rate');await inject(null);
  await popup.locator('#btn-reply-test-three').click();
  await popup.locator('#reply-test-status').filter({hasText:'HTTP 429'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.sent.map(s=>s.id)),['1']);
  const limited=await worker.evaluate(async()=> (await chrome.storage.local.get('replyTestState')).replyTestState);
  assert.equal(limited.completedCount,1);assert.equal(limited.active,false);
  // An unconfirmed first submission never proceeds to the next post.
  await reset('uncertain');
  await popup.locator('#btn-reply-test-three').click();
  await popup.locator('#reply-test-status').filter({hasText:'发布结果待确认'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.sent.map(s=>s.id)),['1']);
  assert.deepEqual(await page.evaluate(()=>window.actions),['open:1','publish:1']);
  console.log('PASS: own posts/replies excluded including timeline reappearance, persistent reply IDs, configurable five-item batch/25–45s bounds/settings restore/invalid range/loading more, hundred-reply random pool with no batch repeats, batch of three, bounded requested waits, home after each, stop during wait, 429 stops next item, uncertainty stops batch');
 }finally{if(context)await context.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
