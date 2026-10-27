(() => {
  'use strict';
  const C=globalThis.XReplyTest;
  let busy=false, runId=null, trace=[], diagnostics={}, stage=null, didClick=false;
  let batchTotal=1,itemIndex=0,results=[],stopRequested=false,rateLimited=false,testTabId=null,currentPost=null,currentReply=null,unconfirmed=false,batchAccount=null;
  let settings=C.validateSettings(),lastHeartbeat=0,requestFailure=null;
  const diagnosticChannel='X_REPLY_DIAGNOSTICS_V1';
  let journal=null,latestState=null,persistence=Promise.resolve(),diagnosticUntil=0;
  const persist=()=>{
    persistence=persistence.catch(()=>{}).then(()=>chrome.storage.local.set({replyTestState:{...latestState,...journal.export()}}));
    return persistence;
  };
  window.addEventListener('message',event=>{
    if((!busy && Date.now()>diagnosticUntil) || !journal || event.source!==window || event.origin!==location.origin || event.data?.channel!==diagnosticChannel || event.data.runId!==runId) return;
    const m=event.data;
    if(m.type==='READY') {journal.markReady();persist().catch(()=>{});}
    if(m.type==='NETWORK' && ['HomeTimeline','HomeLatestTimeline','TweetDetail','CreateTweet'].includes(m.event?.operation) && ['started','completed','failed'].includes(m.event?.phase)) {
      const e=m.event;
      if(e.status===429) rateLimited=true;
      if(e.status>=400) requestFailure=`${e.operation} 请求失败：HTTP ${e.status}，测试停止`;
      // Diagnostic messages never decide whether a publication succeeded.
      journal.addNetwork({requestId:e.requestId,operation:e.operation,phase:e.phase,method:String(e.method).slice(0,10),url:String(e.url).split(/[?#]/)[0].slice(0,300),status:Number.isFinite(e.status)?e.status:null,elapsedMs:e.elapsedMs,time:e.time});
      persist().catch(()=>{});
    }
  });
  const exception=(type,error)=>{
    if(!busy || !journal) return;
    journal.addException({type,time:new Date().toISOString(),stage,itemIndex,message:String(error?.message || error || 'unknown').slice(0,500),stack:String(error?.stack || '').slice(0,3000)});
    persist().catch(()=>{});
  };
  window.addEventListener('error',e=>exception('page_error',e.error || e.message));
  window.addEventListener('unhandledrejection',e=>exception('unhandled_rejection',e.reason));
  window.addEventListener('pagehide',()=>{
    if(!busy || !journal) return;
    exception('interrupted','测试期间页面刷新或离开，可能尚未执行或无法确认发布结果');
    status('uncertain',{message:'页面已离开，测试中断；请检查 X 上的结果，不会自动重试。'}).catch(()=>{});
  });
  const stageLabels={finding_next:'加载下一条帖子',reading_wait:'页面已就绪，等待阅读',prepublish_wait:'已填入，等待发布',postpublish_wait:'回复已确认，等待返回',returning_home:'返回首页',home_ready:'已回到首页',completed:'测试完成',stopped:'已停止测试',reading:'读取帖子',opening:'进入详情',generating:'模拟生成回复',filling:'回填回复',checking_account:'识别登录账号',waiting_button:'等待回复按钮可点击',publishing:'准备发布',confirming:'已点击回复，确认结果',published:'已确认发布',uncertain:'结果待确认，请检查插件提示',error:'测试停止'};
  const banner=document.createElement('div');
  banner.setAttribute('data-x-reply-test-status','');
  banner.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:320px;padding:10px 14px;border-radius:8px;background:#1d6da5;color:white;font:13px/1.5 sans-serif;pointer-events:none;';
  const visible=el=>{
    if(!el?.isConnected || !el.getClientRects().length) return false;
    for(let node=el;node instanceof Element;node=node.parentElement) {
      const style=getComputedStyle(node);
      if(style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || Number(style.opacity)===0) return false;
    }
    return true;
  };
  function actionRect(el) {
    if(!visible(el) || el.disabled || el.closest('[inert], [aria-disabled="true"], [aria-busy="true"]')) return null;
    const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    if(r.width<=0 || r.height<=0 || x<0 || y<0 || x>=innerWidth || y>=innerHeight) return null;
    const hit=document.elementFromPoint(x,y);
    return hit && (hit===el || el.contains(hit))?[r.x,r.y,r.width,r.height]:null;
  }
  const sameRect=(a,b)=>a && b && a.every((v,i)=>Math.abs(v-b[i])<=1);
  async function prepareAction(el,label,check=()=>{}) {
    check();guard();
    if(!el?.isConnected) throw Error(`${label}已消失，测试停止`);
    el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    let previous=null,stableSince=0;
    return waitFor(()=>{
      check();
      if(!el.isConnected) throw Error(`${label}已被替换，测试停止`);
      const rect=actionRect(el);
      if(!rect) {previous=null;stableSince=0;return null;}
      if(!sameRect(previous,rect)) {previous=rect;stableSince=Date.now();return null;}
      if(Date.now()-stableSince<600) return null;
      diagnostics.actions={...(diagnostics.actions || {}),[label]:{rect,stableMs:Date.now()-stableSince}};
      return rect;
    },`${label}被遮挡、不可用或位置尚未稳定，未执行操作`,50);
  }
  function assertAction(el,rect,label) {
    if(!sameRect(rect,actionRect(el))) throw Error(`${label}状态或位置已变化，未执行操作`);
  }
  const isAd=article=>!!article.closest('[data-testid="placementTracking"]') || !!article.querySelector('[data-testid="promotedIndicator"], [data-testid="placementTracking"]');
  function accountHandle() {
    const link=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
    try{return link && new URL(link,location.href).pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/?$/)?.[1]?.toLowerCase();}catch{return null;}
  }
  function postIdentity(article) {
    const links=[...article.querySelectorAll('a[href*="/status/"]')];
    const link=links.find(a=>a.querySelector('time') && !a.parentElement?.closest('[data-testid="quoteTweet"], [role="link"]') && C.postUrl(a.getAttribute('href'),location.href));
    const url=C.postUrl(link?.getAttribute('href'),location.href);
    if(!url) return null;
    return {id:url.match(/\/status\/(\d+)$/)[1],url,authorHandle:new URL(url).pathname.split('/')[1],publishedAt:link.querySelector('time')?.getAttribute('datetime') || null};
  }
  function readPost(article) {
    const identity=postIdentity(article);
    if(!identity) return null;
    const textNode=[...article.querySelectorAll('[data-testid="tweetText"]')].find(node=>!node.closest('[role="link"], [data-testid="quoteTweet"]'));
    const text=textNode?.innerText?.trim() || '';
    if(!text || article.querySelector('[data-testid="tweet-text-show-more-link"]')) return null;
    return {...identity,text,readAt:new Date().toISOString()};
  }
  const status=async(state,extra={})=>{
    const time=new Date().toISOString();
    trace.push({itemIndex,batchTotal,stage:state,time,message:extra.message || null});stage=state;
    banner.textContent=`回复测试 ${itemIndex}/${batchTotal}：${stageLabels[state] || state}${extra.message?' · '+extra.message:''}`;
    banner.style.background=['error','uncertain'].includes(state)?'#8c2030':'#1d6da5';
    if(!banner.isConnected) (document.body || document.documentElement).appendChild(banner);
    journal.snapshot(state,{itemIndex,batchTotal});
    latestState={runId,state,updatedAt:time,clicked:didClick,trace,diagnostics,tabId:testTabId,batchTotal,itemIndex,results,completedCount:results.length,account:batchAccount,replyPoolSize:C.replyPool.length,settings,active:!['completed','stopped','error','uncertain'].includes(state),post:currentPost,reply:currentReply,...extra};
    await persist();
  };
  async function waitFor(check,message='等待帖子或回复框超时，请确认页面已加载且账号可以回复',interval=150) {
    const until=Date.now()+12000;
    while(Date.now()<until) {guard();const value=check();if(value) return value;await new Promise(r=>setTimeout(r,interval));}
    throw Error(message);
  }
  function editorFor(article) {
    const scope=article.closest('[data-testid="cellInnerDiv"]');
    const selector='[data-testid="tweetTextarea_0"][contenteditable="true"], [role="textbox"][contenteditable="true"][data-testid^="tweetTextarea_"]';
    // A detail page has one inline composer. Never select an unrelated dialog editor.
    const local=scope?.querySelector(selector);
    if(visible(local) && !local.closest('[role="dialog"]')) return local;
    const editors=[...document.querySelectorAll(selector)].filter(e=>visible(e) && !e.closest('[role="dialog"]'));
    return editors.length===1?editors[0]:null;
  }
  function guard(expectedUrl) {
    if(busy && latestState && Date.now()-lastHeartbeat>5000) {
      lastHeartbeat=Date.now();latestState.heartbeatAt=new Date().toISOString();
      window.postMessage({channel:diagnosticChannel,type:'HEARTBEAT',runId},location.origin);
      persist().catch(()=>{});
    }
    if(stopRequested) throw Error('已停止测试');
    if(rateLimited) throw Error('X 返回 HTTP 429 限流，测试停止，不再处理下一条');
    if(requestFailure) throw Error(requestFailure);
    if([...document.querySelectorAll('[role="dialog"], iframe[src*="captcha"], iframe[src*="challenge"]')].some(visible)) throw Error('页面出现弹窗或验证，测试停止，请手动处理');
    if(/^\/(?:account\/access|i\/flow|login)(?:\/|$)/.test(location.pathname)) throw Error('页面进入登录或验证流程，测试停止');
    if(expectedUrl && C.postUrl(location.href)!==expectedUrl) throw Error('页面已切换，测试停止');
  }
  async function pause(state,ms,expectedUrl) {
    guard(expectedUrl);
    diagnostics.delays={...(diagnostics.delays || {}),[state]:ms};
    await status(state,{waitMs:ms,waitUntil:new Date(Date.now()+ms).toISOString(),message:`等待 ${(ms/1000).toFixed(1)} 秒`});
    await C.sleep(ms,()=>guard(expectedUrl));
    guard(expectedUrl);
  }
  async function goHome(expectedUrl) {
    guard(expectedUrl);
    await status('returning_home');
    const link=[...document.querySelectorAll('[data-testid="AppTabBar_Home_Link"],nav a[href="/home"]')].find(visible);
    if(!link) throw Error('已发布，但找不到首页导航；测试停止，不会再次发布');
    const rect=await prepareAction(link,'首页导航',()=>guard(expectedUrl));
    guard(expectedUrl);assertAction(link,rect,'首页导航');link.click();
    await waitFor(()=>location.pathname==='/home' && document.querySelector('article[data-testid="tweet"]'));
    await C.sleep(500,guard);
    await status('home_ready');
  }
  async function processOne() {
    let selected;
      await status('reading');
      const detailUrl=C.postUrl(location.href);
      if(!detailUrl && location.pathname!=='/home') throw Error('请在 X 首页或一条帖子的详情页运行测试');
      if(document.querySelector('[role="dialog"]')) throw Error('请先关闭当前弹窗再测试');
      const account=accountHandle();
      if(!account) throw Error('无法识别当前登录账号，不能排除自己的帖子，测试停止');
      if(batchAccount && batchAccount!==account) throw Error('登录账号已切换，测试停止');
      batchAccount=account;
      const stored=await chrome.storage.local.get(['replyTestClaims','replyTestOwnReplies']);
      const knownClaims=stored.replyTestClaims || {},ownReplies={...(stored.replyTestOwnReplies || {})};
      for(const result of results) {const id=C.postUrl(result.replyUrl)?.match(/\/status\/(\d+)$/)?.[1];if(id)ownReplies[id]={};}
      let reviewed=[],entry;
      diagnostics.selection={account,scans:[],candidates:[]};
      for(let scan=0;scan<6;scan++) {
        guard();
        if(!detailUrl && location.pathname!=='/home') throw Error('选帖时页面已切换，测试停止');
        const candidates=[...document.querySelectorAll('article[data-testid="tweet"]')].filter(a=>!isAd(a));
        reviewed=candidates.map(article=>{
          const identity=postIdentity(article),post=readPost(article);
          return {article,post,identity,reason:identity?C.exclusionReason(identity,account,ownReplies,knownClaims):'unreadable'};
        });
        const summary=reviewed.slice(0,50).map(e=>({id:e.identity?.id || null,authorHandle:e.identity?.authorHandle || null,reason:e.reason}));
        diagnostics.selection.candidates=summary;diagnostics.selection.scans.push({scan,candidates:summary});
        const eligible=reviewed.filter(e=>!e.reason && (batchTotal===1 || e.post));
        entry=detailUrl?reviewed.find(e=>e.identity?.url===detailUrl):eligible[0];
        if(entry || detailUrl || batchTotal===1 || scan===5) break;
        await status('finding_next',{message:'向下加载未处理的帖子'});
        guard();window.scrollBy({top:Math.max(500,innerHeight*0.8),behavior:'instant'});
        await C.sleep(1000,guard);
      }
      if(entry?.reason==='own_author' || entry?.reason==='own_reply') throw Error('这是当前账号自己的帖子或回复，已排除，不会回复自己');
      if(entry?.reason==='already_processed') throw Error('此帖子已提交过测试回复，不会重复发布；请先到 X 检查结果');
      if(!entry?.post) {
        if(reviewed.some(e=>e.reason==='already_processed')) throw Error('首页当前帖子均已提交过或被排除，暂无新目标');
        throw Error(batchTotal>1?'首页暂无可处理的未回复文字帖，测试停止':'第一条帖子无法完整读取文字，测试停止，不会改为处理下一条');
      }
      selected=entry.post;currentPost=selected;
      const {replyTestClaims:claims={}}=await chrome.storage.local.get('replyTestClaims');
      if(claims[selected.id]) throw Error('此帖子已提交过测试回复，不会重复发布；请先到 X 检查结果');
      await status('opening',{post:selected});
      if(!detailUrl) {
        guard();
        const link=[...entry.article.querySelectorAll('a[href*="/status/"]')].find(a=>C.postUrl(a.getAttribute('href'),location.href)===selected.url && a.querySelector('time'));
        const homeUrl=location.href;
        const rect=await prepareAction(link,'帖子入口',()=>{if(location.href!==homeUrl)throw Error('选帖时页面已切换，测试停止');});
        guard();assertAction(link,rect,'帖子入口');link.click();
      }
      const article=await waitFor(()=>{
        const current=C.postUrl(location.href);
        if(current && current!==selected.url) throw Error('页面已切换到其他帖子，测试停止');
        if(current!==selected.url) return null;
        const found=[...document.querySelectorAll('article[data-testid="tweet"]')].find(a=>readPost(a)?.url===selected.url);
        return document.readyState!=='loading' && found && found.getAttribute('aria-busy')!=='true' && !found.querySelector('[role="progressbar"]') && editorFor(found)?found:null;
      });
      selected=readPost(article);currentPost=selected;
      if(!selected) throw Error('详情页正文尚未完整显示，测试停止');
      await pause('reading_wait',C.randomDelayMs(),selected.url);
      await status('generating',{post:selected});
      const response=await C.requestReply(selected,{usedReplies:results.map(r=>r.reply)});currentReply=response.reply;
      diagnostics.replyChoice={source:response.source,poolIndex:response.poolIndex,poolSize:response.poolSize};
      const editor=await waitFor(()=>{
        if(C.postUrl(location.href)!==selected.url) throw Error('页面已切换，测试停止');
        return editorFor(article);
      });
      if(editor.innerText.trim()) throw Error('回复框已有草稿，保留原内容，请清空后再测试');
      if(editor.getAttribute('aria-disabled')==='true') throw Error('当前回复框不可编辑');
      await status('filling',{post:selected,reply:response.reply});
      guard(selected.url);
      const editorRect=await prepareAction(editor,'回复框',()=>guard(selected.url));
      if(editor.innerText.trim()) throw Error('回复框已有草稿，保留原内容，请清空后再测试');
      guard(selected.url);assertAction(editor,editorRect,'回复框');editor.focus();
      if(document.activeElement!==editor && !editor.contains(document.activeElement)) throw Error('回复框未取得焦点，未回填');
      const text=()=>editor.innerText.replace(/\u200b/g,'').trim();
      // Let X's controlled editor handle paste once. Native insertText can be
      // applied by both the browser and the app's beforeinput handler.
      let handled=false;
      try {
        const data=new DataTransfer();data.setData('text/plain',response.reply);
        const paste=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});
        editor.dispatchEvent(paste);handled=paste.defaultPrevented;
      } catch { /* Plain editors may only support native editing. */ }
      await new Promise(r=>setTimeout(r,250));
      guard(selected.url);
      if(!editor.isConnected || (document.activeElement!==editor && !editor.contains(document.activeElement))) throw Error('回复框或焦点已变化，测试停止');
      diagnostics={...diagnostics,pasteHandled:handled,fillMethod:'paste'};
      if(!handled && !text()) {
        diagnostics.fillMethod='native';
        document.execCommand('insertText',false,response.reply);
      }
      const deadline=Date.now()+2000;
      while(!text() && Date.now()<deadline) {guard(selected.url);await new Promise(r=>setTimeout(r,100));}
      guard(selected.url);
      diagnostics.expectedLength=response.reply.length;diagnostics.actualLength=text().length;
      if(text()!==response.reply) throw Error(`回填内容校验未通过：应为 ${response.reply.length} 字，实际 ${text().length} 字；未点击回复`);
      await pause('prepublish_wait',C.randomDelayMs(),selected.url);
      await status('checking_account',{post:selected,reply:response.reply});
      if(accountHandle()!==account || selected.authorHandle.toLowerCase()===account) throw Error('账号或目标作者已变化，未发布');
      await status('waiting_button',{post:selected,reply:response.reply});
      const publishButton=await waitFor(()=>{
        if(C.postUrl(location.href)!==selected.url || !editor.isConnected || editor.innerText.trim()!==response.reply) throw Error('页面或草稿已变化，未发布');
        const buttons=[...document.querySelectorAll('[data-testid="tweetButtonInline"]')].filter(b=>visible(b) && !b.closest('[role="dialog"]'));
        diagnostics.buttons=buttons.map(b=>({testId:b.getAttribute('data-testid'),disabled:!!b.disabled,ariaDisabled:b.getAttribute('aria-disabled')}));
        return buttons.length===1 && !buttons[0].disabled && buttons[0].getAttribute('aria-disabled')!=='true'?buttons[0]:null;
      });
      const publishRect=await prepareAction(publishButton,'回复按钮',()=>{
        guard(selected.url);
        if(!editor.isConnected || editor.innerText.trim()!==response.reply || accountHandle()!==account) throw Error('页面、账号或草稿已变化，未发布');
      });
      const before=new Set([...document.querySelectorAll('article[data-testid="tweet"]')].map(a=>readPost(a)?.id).filter(Boolean));
      await status('publishing',{post:selected,reply:response.reply,mock:true});
      const claim=await chrome.runtime.sendMessage({type:'REPLY_TEST_CLAIM',postId:selected.id,runId});
      if(!claim?.ok) throw Error(claim?.error || '无法确认重复提交状态，未发布');
      if(C.postUrl(location.href)!==selected.url || !publishButton.isConnected || publishButton.disabled || publishButton.getAttribute('aria-disabled')==='true' || !editor.isConnected || editor.innerText.trim()!==response.reply) throw Error('发布前页面状态已变化，测试停止');
      if(accountHandle()!==account || postIdentity(article)?.authorHandle.toLowerCase()===account) throw Error('发布前账号或作者检查未通过');
      guard(selected.url);assertAction(publishButton,publishRect,'回复按钮');unconfirmed=true;didClick=true;
      publishButton.click();
      await status('confirming',{post:selected,reply:response.reply});
      const published=await waitFor(()=>{
        if(C.postUrl(location.href)!==selected.url) throw Error('页面已切换，无法确认发布结果');
        if(editor.isConnected && editor.innerText.trim()) return null;
        return [...document.querySelectorAll('article[data-testid="tweet"]')].map(readPost).find(p=>p && !before.has(p.id) && p.text===response.reply && p.authorHandle.toLowerCase()===account);
      });
      unconfirmed=false;
      const afterReplyMs=C.randomBetweenMs(settings.intervalMinSec*1000,settings.intervalMaxSec*1000);
      results.push({index:itemIndex,post:selected,reply:response.reply,replyUrl:published.url,state:'published',replyChoice:diagnostics.replyChoice,publishedAt:new Date().toISOString(),delays:{...diagnostics.delays,postpublish_wait:afterReplyMs}});
      const savedReply=await chrome.runtime.sendMessage({type:'REPLY_TEST_CONFIRMED',postId:selected.id,replyId:published.id,account,runId});
      if(!savedReply?.ok) throw Error(savedReply?.error || '回复已发布，但保存自身回复排除记录失败，测试停止');
      await status('published',{post:selected,reply:response.reply,replyUrl:published.url,message:'已确认新回复，等待后返回首页。'});
      await pause('postpublish_wait',afterReplyMs,selected.url);
      await goHome(selected.url);
  }
  async function run() {
    try {
      if(batchTotal>1 && location.pathname!=='/home') throw Error('测试多条请从 X 首页开始');
      for(itemIndex=1;itemIndex<=batchTotal;itemIndex++) {
        guard();didClick=false;unconfirmed=false;diagnostics={};currentPost=null;currentReply=null;
        await processOne();
      }
      itemIndex=batchTotal;
      await status('completed',{message:`已发布 ${results.length} 条，并回到首页。`});
    } catch(error) {
      exception('test_error',error);
      await status(stopRequested?'stopped':unconfirmed?'uncertain':'error',{failedStage:stage,itemIndex,message:String(error.message || error)+(unconfirmed?'；已点击回复，请检查结果，不会重试。':'')});
    } finally {
      const finishedRun=runId;diagnosticUntil=Date.now()+(didClick?1500:0);
      setTimeout(()=>window.postMessage({channel:diagnosticChannel,type:'STOP',runId:finishedRun},location.origin),didClick?1500:0);
      busy=false;
    }
  }
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(!['REPLY_TEST_START','REPLY_TEST_STOP'].includes(m?.type)) return;
    if(sender.id!==chrome.runtime.id) {reply({ok:false,error:'无效的测试来源'});return;}
    if(m.type==='REPLY_TEST_STOP') {stopRequested=true;reply({ok:true});return;}
    if(busy) {reply({ok:false,error:'回复测试正在进行，请先停止'});return;}
    try{settings=C.validateSettings(m.settings || {count:m.count ?? 1});}catch(error){reply({ok:false,error:error.message});return;}
    batchTotal=settings.count;itemIndex=1;results=[];batchAccount=null;stopRequested=false;rateLimited=false;requestFailure=null;testTabId=m.tabId || null;
    busy=true;trace=[];diagnostics={};stage=null;didClick=false;runId=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
    diagnosticUntil=Date.now()+90000;journal=XReplyDiagnostics.create(runId,{count:batchTotal});latestState={runId,state:'starting',updatedAt:new Date().toISOString()};
    window.postMessage({channel:diagnosticChannel,type:'START',runId,maxDurationMs:90000,maxRequests:Math.min(5000,batchTotal*30+50)},location.origin);
    reply({ok:true,runId});run();
  });
})();
