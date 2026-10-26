// Optional real Chromium check with an isolated temporary profile and fixture API.
// PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-smoke.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(),'x-follow-smoke-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless:true, ignoreDefaultArgs:['--disable-extensions'], executablePath:process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), args:[`--disable-extensions-except=${root}`, `--load-extension=${root}`], acceptDownloads:true });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    let likes = 3;
    let initialFetch = false;
    let responseStatus = 200;
    let replayTerminal = false;
    let replayReal = false;
    const realPosts=JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/posts-page.json'),'utf8'));
    const realReplies=JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/replies-page.json'),'utf8'));
    const terminalFixture = JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/replies-terminal-page.json'),'utf8'));
    await context.route('https://example.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>External fixture</title>External fixture'}));
    await context.route('https://x.com/**', route => {
      if (route.request().url().includes('/graphql/')) {
        if (replayReal) return route.fulfill({json:route.request().url().includes('/UserOriginalsTimeline?')?realPosts.response:realReplies.response});
        if (replayTerminal) return route.fulfill({json:terminalFixture.response});
        if (responseStatus !== 200) return route.fulfill({status:responseStatus,json:{errors:[{message:'Rate limited'}]}});
        return route.fulfill({json:{data:{user:{result:{timeline_v2:{timeline:{instructions:[{entries:[{content:{itemContent:{tweet_results:{result:{__typename:'Tweet',rest_id:'100',legacy:{full_text:'Fixture tweet',favorite_count:likes,created_at:'Mon Oct 19 10:00:00 +0000 2026',user_id_str:'9'},core:{user_results:{result:{rest_id:'9',legacy:{screen_name:'writer',name:'Writer'}}}}}}}}}]}]}}}}}}});
      }
      return route.fulfill({contentType:'text/html',body:(initialFetch ? '<script>fetch("/i/api/graphql/fixture/UserTweets?variables=%7B%22userId%22%3A%221%22%7D").then(r=>r.json())</script>' : '')+'<!doctype html><html><head><title>Fixture</title></head><body><div id="react-root">Fixture profile</div></body></html>'});
    });
    const page = await context.newPage();
    page.on('pageerror', error => console.error('Fixture page error:',error.message));
    await page.goto('https://x.com/alice');
    const capture = async (operation, userId) => page.evaluate(async ({operation,userId}) => {
      const url = `/i/api/graphql/fixture/${operation}?variables=${encodeURIComponent(JSON.stringify({userId}))}`;
      const data = await (await fetch(url)).json();
      if (!data.data && !data.errors) throw Error('Host response consumed');
    },{operation,userId});
    const read = key => worker.evaluate(async key => (await chrome.storage.local.get(key))[key],key);
    async function waitFor(check) {
      for(let n=0;n<100;n++) {if(await check()) return;await new Promise(r=>setTimeout(r,30));}
      throw Error('Timed out waiting for capture');
    }
    // Opening a profile alone must not record anything.
    await capture('UserTweets','1');
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await read('capture:1:posts'),undefined);
    const popup=await context.newPage();
    await popup.setViewportSize({width:380,height:600});
    const errors=[];popup.on('pageerror',e=>errors.push(e.message));
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    const profileTabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://x.com/alice'}))[0].id);
    // This test opens the popup as a tab; a real action popup queries its X tab.
    await popup.evaluate(id=>{chrome.tabs.query=async()=>[await chrome.tabs.get(id)];},profileTabId);
    await popup.getByRole('button',{name:'采集数据',exact:true}).click();
    async function start() {
      await popup.getByRole('button',{name:'刷新',exact:true}).click();
      const button=popup.getByRole('button',{name:'开始采集',exact:true});
      await button.click();
      await popup.getByText(/^采集中：/).waitFor();
    }
    await start();
    await capture('UserTweets','1');
    await waitFor(async()=>!!(await read('capture:1:posts')));
    likes=12;await capture('UserTweets','1');
    await waitFor(async()=>(await read('capture:1:posts'))?.items['100'].metrics.likes===12);
    initialFetch=true; likes=18;
    await page.reload();
    await waitFor(async()=>(await read('capture:1:posts'))?.items['100'].metrics.likes===18);
    initialFetch=false;
    await page.goto('https://example.test/');
    await page.goBack();
    likes=88;await capture('UserTweets','1');
    await new Promise(r=>setTimeout(r,100));
    assert.equal((await read('capture:1:posts')).items['100'].metrics.likes,18);
    await start();
    await popup.getByRole('button',{name:'停止采集',exact:true}).click();
    await popup.getByText(/^已停止：/).waitFor();
    initialFetch=true; likes=99;
    await page.reload();
    initialFetch=false;
    await capture('UserTweets','1');
    await new Promise(r=>setTimeout(r,100));
    assert.equal((await read('capture:1:posts')).items['100'].metrics.likes,18);
    likes=12;
    await start();
    await page.evaluate(()=>history.pushState({},'', '/alice/with_replies'));
    await capture('UserRepliesTimeline','1');
    // No restart: the first request immediately after pushState must be captured.

    await waitFor(async()=>!!(await read('capture:1:replies')));
    replayTerminal=true;
    await capture('UserRepliesTimeline','1');
    await popup.getByText(/接口已返回列表末尾/).waitFor();
    assert.equal(Object.keys((await read('capture:1:replies')).items).length,1);
    replayTerminal=false;
    // Switch back without restarting and verify the posts collection updates.
    likes=17;
    await page.evaluate(()=>history.pushState({},'', '/alice'));
    await capture('UserTweets','1');
    await waitFor(async()=>(await read('capture:1:posts'))?.items['100'].metrics.likes===17);
    await popup.getByRole('button',{name:'刷新',exact:true}).click();
    await popup.getByText(/^采集中：/).waitFor();
    await page.evaluate(()=>history.pushState({},'', '/bob'));
    await new Promise(r=>setTimeout(r,400));
    await start();await capture('UserTweets','2');
    await waitFor(async()=>Object.keys(await read('captureIndex')||{}).length===3);
    assert.equal(Object.keys((await read('capture:1:posts')).items).length,1);
    await popup.locator('.capture-card').first().waitFor();
    assert.equal(await popup.locator('.capture-card').count(),3);
    const alicePosts=popup.locator('.capture-card').filter({hasText:'@alice'}).filter({hasText:'· 帖子'});
    const [download] = await Promise.all([popup.waitForEvent('download'),alicePosts.getByRole('button',{name:'导出帖子 JSON'}).click()]);
    assert.match(download.suggestedFilename(),/^alice_1_posts_\d{8}_\d{6}\.json$/);
    const json=JSON.parse(await fs.readFile(await download.path(),'utf8'));
    assert.equal(json.owner.id,'1');assert.equal(json.tab,'posts');assert.equal(json.count,1);assert.equal(json.items[0].metrics.likes,17);
    for(const name of ['取关助手','运行记录','关注助手','采集数据']) {
      await popup.getByRole('button',{name,exact:true}).click();
      assert.equal(await popup.locator('.tab-view.active').count(),1);
      assert.equal(await popup.locator('.tab-btn.active').textContent(),name);
    }
    const bob=popup.locator('.capture-card').filter({hasText:'@bob'});
    popup.once('dialog',dialog=>dialog.accept());
    await bob.getByRole('button',{name:'清空',exact:true}).click();
    await waitFor(async()=>!(await read('capture:2:posts')));
    await capture('UserTweets','2');
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await read('capture:2:posts'),undefined);
    assert.ok(await read('capture:1:posts'));
    assert.ok(await read('capture:1:replies'));
    await start();
    const requestFailures=[];
    page.on('console',m=>{if(m.type()==='error' && m.text().includes('[X-Follow 采集] 保存失败')) requestFailures.push(m.text());});
    responseStatus=429;
    await capture('UserTweets','2');
    await popup.locator('#capture-feedback').filter({hasText:'HTTP 429'}).waitFor();
    assert.equal(await read('capture:2:posts'),undefined);
    assert.equal((await read('captureError')).kind,'rate_limit');
    assert.deepEqual(requestFailures,[]);
    assert.ok(!(await popup.locator('#capture-feedback').textContent()).includes('保存失败'));
    responseStatus=200;replayReal=true;
    await page.goto('https://x.com/Yudian_Zero');
    await start();
    const ownerId=realPosts.variables.userId;
    await capture('UserOriginalsTimeline',ownerId);
    await waitFor(async()=>Object.keys((await read(`capture:${ownerId}:posts`))?.items || {}).length===1);
    await page.evaluate(()=>history.pushState({},'', '/Yudian_Zero/with_replies'));
    await capture('UserRepliesTimeline',ownerId);
    await waitFor(async()=>Object.keys((await read(`capture:${ownerId}:replies`))?.items || {}).length===4);
    for (const [category,count] of [['帖子',1],['回复',4]]) {
      const card=popup.locator('.capture-card').filter({hasText:'@Yudian_Zero'}).filter({hasText:`· ${category}`});
      const [file]=await Promise.all([popup.waitForEvent('download'),card.getByRole('button',{name:`导出${category} JSON`}).click()]);
      const exported=JSON.parse(await fs.readFile(await file.path(),'utf8'));
      assert.equal(exported.count,count);assert.equal(exported.owner.id,ownerId);
      assert.ok(exported.items.every(t=>t.id && t.text && t.author.id));
    }
    // Real scroll events trigger page-owned fetch requests while the popup is closed.
    const beforePages=(await read(`capture:${ownerId}:replies`)).pageCount;
    await page.evaluate(ownerId=>{
      document.body.style.height='20000px';
      window.addEventListener('scroll',()=>fetch(`/i/api/graphql/fixture/UserRepliesTimeline?variables=${encodeURIComponent(JSON.stringify({userId:ownerId}))}`));
    },ownerId);
    await popup.getByRole('button',{name:'开始滚动',exact:true}).click();
    await popup.goto('about:blank');
    await waitFor(async()=>(await read(`capture:${ownerId}:replies`)).pageCount>beforePages);
    assert.ok(await page.evaluate(()=>scrollY)>0);
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popup.evaluate(id=>{chrome.tabs.query=async()=>[await chrome.tabs.get(id)];},profileTabId);
    await popup.getByRole('button',{name:'采集数据',exact:true}).click();
    await popup.getByRole('button',{name:'停止滚动',exact:true}).click();
    await popup.getByText(/^采集中：/).waitFor();
    const stoppedY=await page.evaluate(()=>scrollY);
    await page.waitForTimeout(2800);
    assert.equal(await page.evaluate(()=>scrollY),stoppedY);
    const manualBefore=(await read(`capture:${ownerId}:replies`)).pageCount;
    await capture('UserRepliesTimeline',ownerId);
    await waitFor(async()=>(await read(`capture:${ownerId}:replies`)).pageCount>manualBefore);
    await popup.getByRole('button',{name:'开始滚动',exact:true}).click();
    await popup.getByRole('button',{name:'停止采集',exact:true}).click();
    await popup.getByText(/^已停止：/).waitFor();
    const stoppedPages=(await read(`capture:${ownerId}:replies`)).pageCount;
    await waitFor(async()=>await page.evaluate(()=>scrollY)>stoppedY);
    await capture('UserRepliesTimeline',ownerId);
    await page.waitForTimeout(150);
    assert.equal((await read(`capture:${ownerId}:replies`)).pageCount,stoppedPages);
    await popup.getByRole('button',{name:'停止滚动',exact:true}).click();
    // Recorder: trusted clicks, dialog/input, reload continuity, stop and export.
    await popup.getByRole('button',{name:'操作录制',exact:true}).click();
    const installInteractionFixture=()=>page.evaluate(()=>{
      document.body.style.height='20000px';window.scrollTo(0,0);
      const article=document.createElement('article');
      article.innerHTML='<a href="/alice/status/123456"><time>now</time></a><button data-testid="reply">Reply</button><input type="password" id="fixture-password">';
      document.body.prepend(article);
      article.querySelector('button').onclick=()=>{
        const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
        dialog.innerHTML='<textarea data-testid="tweetTextarea_0"></textarea><button data-testid="close">Close</button>';
        dialog.querySelector('button').onclick=()=>dialog.remove();document.body.prepend(dialog);
      };
    });
    await installInteractionFixture();
    await page.locator('[data-testid="reply"]').click();
    assert.equal(await read('operationRecording'),undefined);
    await page.locator('[data-testid="close"]').click();
    await popup.getByRole('button',{name:'开始录制',exact:true}).click();
    await page.locator('[data-x-operation-recorder]').waitFor();
    await popup.goto('about:blank');
    await page.locator('[data-testid="reply"]').click();
    await page.locator('textarea').fill('PRIVATE_REPLY_MUST_NOT_BE_EXPORTED');
    await page.waitForTimeout(450);
    await page.locator('[data-testid="close"]').click();
    await page.locator('#fixture-password').fill('PASSWORD_MUST_NOT_BE_EXPORTED');
    await page.evaluate(()=>history.pushState({},'', '/alice/status/123456?private=query'));
    await waitFor(async()=>(await read('operationRecording'))?.events.some(e=>e.type==='navigation'));
    const beforeReload=(await read('operationRecording')).events.length;
    await page.reload();
    await page.locator('[data-x-operation-recorder]').waitFor();
    await waitFor(async()=>(await read('operationRecording')).events.length>beforeReload);
    await installInteractionFixture();
    await page.locator('[data-testid="reply"]').click();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popup.evaluate(id=>{chrome.tabs.query=async()=>[await chrome.tabs.get(id)];},profileTabId);
    await popup.getByRole('button',{name:'操作录制',exact:true}).click();
    await popup.getByRole('button',{name:'停止录制',exact:true}).click();
    await waitFor(async()=>(await read('operationRecording'))?.events.some(e=>e.type==='recording_stop'));
    const stoppedLog=await read('operationRecording');
    assert.ok(stoppedLog.events.some(e=>e.type==='click' && e.target.testId==='reply' && e.post.id==='123456'));
    for(const type of ['input','dialog_open','dialog_close','navigation','recording_stop']) assert.ok(stoppedLog.events.some(e=>e.type===type),type);
    assert.ok(!JSON.stringify(stoppedLog).includes('MUST_NOT_BE_EXPORTED'));
    assert.ok(!JSON.stringify(stoppedLog).includes('private=query'));
    await page.locator('[data-testid="close"]').click();
    await page.waitForTimeout(450);
    assert.equal((await read('operationRecording')).events.length,stoppedLog.events.length);
    const recordingDownload=popup.waitForEvent('download');
    await popup.getByRole('button',{name:'导出操作日志 JSON',exact:true}).click();
    const downloadedRecording=await recordingDownload;
    const exportedRecording=JSON.parse(await fs.readFile(await downloadedRecording.path(),'utf8'));
    assert.equal(exportedRecording.events.length,stoppedLog.events.length);
    await popup.getByRole('button',{name:'清空录制日志',exact:true}).click();
    await waitFor(async()=>(await read('operationRecording'))===undefined);
    await popup.getByRole('button',{name:'采集数据',exact:true}).click();
    assert.deepEqual(errors,[]);
    await popup.locator('#collection-list').evaluate(el=>{el.scrollTop=0;});
    await popup.waitForTimeout(250);
    await popup.screenshot({path:path.join(os.tmpdir(),'x-follow-collection-smoke.png')});
    console.log('PASS: operation recording trusted clicks/dialogs/input privacy/reload/stop/JSON export, active reload captures first response, stopped reload stays off, default off, UI start/stop, same-user posts/replies continuity, other-user navigation stop, dedupe, user/tab isolation, scoped clear, JSON download, auto-scroll capture with popup closed, independent capture/scroll stop controls and popup navigation');
  } finally {if(context) await context.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
