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
    await context.route('https://example.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>External fixture</title>External fixture'}));
    await context.route('https://x.com/**', route => {
      if (route.request().url().includes('/graphql/')) {
        return route.fulfill({json:{data:{user:{result:{timeline_v2:{timeline:{instructions:[{entries:[{content:{itemContent:{tweet_results:{result:{__typename:'Tweet',rest_id:'100',legacy:{full_text:'Fixture tweet',favorite_count:likes,created_at:'Mon Oct 19 10:00:00 +0000 2026',user_id_str:'9'},core:{user_results:{result:{rest_id:'9',legacy:{screen_name:'writer',name:'Writer'}}}}}}}}}]}]}}}}}}});
      }
      return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Fixture</title></head><body><div id="react-root">Fixture profile</div></body></html>'});
    });
    const page = await context.newPage();
    page.on('pageerror', error => console.error('Fixture page error:',error.message));
    await page.goto('https://x.com/alice');
    const capture = async (operation, userId) => page.evaluate(async ({operation,userId}) => {
      const url = `/i/api/graphql/fixture/${operation}?variables=${encodeURIComponent(JSON.stringify({userId}))}`;
      const data = await (await fetch(url)).json();
      if (!data.data) throw Error('Host response consumed');
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
    await popup.evaluate(id=>{chrome.tabs.query=async()=>[{id}];},profileTabId);
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
    await page.goto('https://example.test/');
    await page.goBack();
    likes=88;await capture('UserTweets','1');
    await new Promise(r=>setTimeout(r,100));
    assert.equal((await read('capture:1:posts')).items['100'].metrics.likes,12);
    await start();
    await popup.getByRole('button',{name:'停止采集',exact:true}).click();
    await popup.getByText(/^已停止：/).waitFor();
    likes=99;await capture('UserTweets','1');
    await new Promise(r=>setTimeout(r,100));
    assert.equal((await read('capture:1:posts')).items['100'].metrics.likes,12);
    likes=12;
    await start();
    await page.evaluate(()=>history.pushState({},'', '/alice/with_replies'));
    await capture('UserTweetsAndReplies','1');
    await new Promise(r=>setTimeout(r,400));
    assert.equal(await read('capture:1:replies'),undefined);
    await start();await capture('UserTweetsAndReplies','1');
    await waitFor(async()=>!!(await read('capture:1:replies')));
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
    assert.equal(json.owner.id,'1');assert.equal(json.tab,'posts');assert.equal(json.count,1);assert.equal(json.items[0].metrics.likes,12);
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
    assert.deepEqual(errors,[]);
    await popup.locator('#collection-list').evaluate(el=>{el.scrollTop=0;});
    await popup.waitForTimeout(250);
    await popup.screenshot({path:path.join(os.tmpdir(),'x-follow-collection-smoke.png')});
    console.log('PASS: default off, UI start/stop, navigation stop, dedupe, user/tab isolation, scoped clear, JSON download and popup navigation');
  } finally {if(context) await context.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
