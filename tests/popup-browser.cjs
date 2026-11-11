const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'x-helper-popup-'));let context;
 try{
  const root=path.resolve(__dirname,'..');
  context=await chromium.launchPersistentContext(profile,{headless:true,ignoreDefaultArgs:['--disable-extensions'],executablePath:process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
  await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Popup fixture</title>'}));
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'),extensionId=new URL(worker.url()).host;
  const page=await context.newPage();await page.goto('https://x.com/alice');
  const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://x.com/alice'}))[0].id);
  await worker.evaluate(async tabId=>{
   await chrome.storage.local.set({popupActiveTab:'recorder',settings:{mode:'FOLLOW',batchSize:15,restTime:15},replyTestSettings:{count:7,intervalMinSec:25,intervalMaxSec:45},replyTestOwnReplies:{'123':{account:'tester',parentId:'12'}}});
   // Report an already-running engine without starting any actual operation.
   await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:()=>{XFollowEngine.isRunning=true;XFollowEngine.mode='FOLLOW';}});
  },tabId);
  const popup=await context.newPage(),errors=[];popup.on('pageerror',e=>errors.push(e.message));await popup.setViewportSize({width:380,height:600});
  await popup.addInitScript(tabId=>{
   if(location.protocol!=='chrome-extension:')return;
   chrome.tabs.query=(query,callback)=>{const result=chrome.tabs.get(tabId).then(tab=>[tab]);if(callback){result.then(callback);return;}return result;};
  },tabId);
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await popup.locator('#view-recorder.active').waitFor();
  await popup.locator('#btn-start').filter({hasText:'停止关注'}).waitFor({state:'attached'});
  assert.equal(await popup.locator('[data-tab="recorder"]').getAttribute('aria-pressed'),'true');
  assert.equal(await popup.locator('[data-tab="unfollow"]').isDisabled(),true);
  // A running engine must not force the user out of tools/replies, and its own page remains reachable.
  await popup.getByRole('button',{name:'回复助手',exact:true}).click();
  await popup.locator('#reply-test-count').filter({visible:true}).waitFor();
  assert.equal(await popup.locator('#reply-test-count').inputValue(),'7');
  assert.equal(await popup.locator('#reply-test-interval-min').inputValue(),'25');
  assert.equal(await popup.locator('#reply-test-interval-max').inputValue(),'45');
  assert.equal(await popup.locator('#btn-reply-test, #btn-reply-test-three').count(),0);
  for(const id of ['#btn-reply-test-configured','#btn-reply-test-stop']){
   const box=await popup.locator(id).boundingBox();assert.ok(box && box.y>=0 && box.y+box.height<=600,`${id} must be visible without scrolling`);
  }
  await popup.getByRole('button',{name:'关注助手',exact:true}).click();await popup.locator('#view-dashboard.active').waitFor();
  assert.equal(await popup.locator('#btn-start').innerText(),'停止关注');
  await worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:()=>{XFollowEngine.isRunning=false;}}),tabId);
  await popup.reload();
  const views={follow:'dashboard',unfollow:'dashboard',reply:'reply',collection:'collection',history:'history',recorder:'recorder'};
  for(const [tab,view] of Object.entries(views)){
   await popup.locator(`[data-tab="${tab}"]`).click();await popup.locator(`#view-${view}.active`).waitFor();
   assert.equal(await popup.locator('.tab-view.active').count(),1);
   assert.ok(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   if(['follow','unfollow'].includes(tab)){
    const action=await popup.locator('#btn-start').boundingBox();
    const hit=await popup.locator('#btn-start').evaluate(button=>{const r=button.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height-2);return hit===button || button.contains(hit);});
    assert.ok(action && action.y+action.height<=600 && hit,'follow/unfollow start button must be fully reachable without scrolling');
   }
   await popup.waitForTimeout(220);
   await popup.screenshot({path:path.join(os.tmpdir(),`x-helper-popup-${tab}.png`)});
   await popup.reload();await popup.locator(`#view-${view}.active`).waitFor();
   assert.equal(await popup.locator(`[data-tab="${tab}"]`).getAttribute('aria-pressed'),'true');
  }
  assert.equal(await popup.locator('#btn-reply-diagnostics').isDisabled(),true);
  const saved=await worker.evaluate(async()=>chrome.storage.local.get(['replyTestSettings','replyTestOwnReplies']));
  assert.deepEqual(saved.replyTestSettings,{count:7,intervalMinSec:25,intervalMaxSec:45});assert.equal(saved.replyTestOwnReplies['123'].parentId,'12');
  assert.deepEqual(errors,[]);
  console.log('PASS: six independent panels, restored navigation while engine running, engine controls reachable, saved reply settings/ownership retained, primary actions visible at 380x600, no page errors or horizontal overflow');
 }finally{if(context)await context.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
