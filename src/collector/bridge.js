/* ISOLATED world: manual controls and response relay. Active capture survives same-profile reloads. */
(() => {
  'use strict';
  if (globalThis.__xFollowCaptureBridge) return;
  globalThis.__xFollowCaptureBridge = true;
  const channel = 'X_FOLLOW_CAPTURE_V1';
  let session = null;
  let initialized = false;
  let currentUrl = location.href;
  const post = (type,extra={}) => window.postMessage({channel,type,...extra},location.origin);
  let scrollTimer = null;
  let scrollOwner = null;
  const pageHandle = () => location.href.match(/^https:\/\/(?:x|twitter)\.com\/([a-zA-Z0-9_]{1,15})(?:\/with_replies)?\/?(?:[?#].*)?$/)?.[1]?.toLowerCase();
  function stopScroll() {
    if (scrollTimer !== null) clearInterval(scrollTimer);
    scrollTimer = null;
    scrollOwner = null;
  }
  function startScroll() {
    const handle = pageHandle();
    if (!handle || ['home','explore','search','notifications','messages','i','settings'].includes(handle)) throw Error('请在用户主页的帖子或回复页面启动滚动');
    if (scrollTimer !== null) return;
    scrollOwner = handle;
    scrollTimer = setInterval(() => {
      if (pageHandle() !== scrollOwner) {stopScroll();return;}
      window.scrollBy({top: Math.max(400, Math.round(window.innerHeight * 0.8)), behavior:'instant'});
    }, 2500);
  }
  const control = value => { session=value;post('CONTROL',{session}); };
  async function command(type) {
    const result = await chrome.runtime.sendMessage({type,pageUrl:location.href,reload:globalThis.performance?.getEntriesByType?.('navigation')?.[0]?.type === 'reload'});
    if (!result?.ok) throw Error(result?.error || '后台未响应');
    initialized = true;
    control(result.session || null);
    return result;
  }
  // Controls are serialized with initial reset and navigation stops.
  let controls = command('CAPTURE_RESTORE').catch(()=>{initialized=true;control(null);});
  function enqueue(type) { const next=controls.catch(()=>{}).then(()=>command(type));controls=next;return next; }
  chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
    if (['SCROLL_START','SCROLL_STOP'].includes(message?.type)) {
      try {
        if (message.type === 'SCROLL_START') startScroll(); else stopScroll();
        sendResponse({ok:true,scrolling:scrollTimer !== null});
      } catch (error) {sendResponse({ok:false,error:error.message});}
      return true;
    }
    if (!['CAPTURE_START','CAPTURE_STOP','CAPTURE_STATUS'].includes(message?.type)) return;
    if (message.type === 'CAPTURE_STOP') control(null);
    enqueue(message.type).then(result=>sendResponse({...result,pageUrl:location.href,scrolling:scrollTimer !== null}),error=>sendResponse({ok:false,error:error.message}));
    return true;
  });
  async function stopOnNavigation() {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    if (scrollOwner && pageHandle() !== scrollOwner) stopScroll();
    await enqueue('CAPTURE_ROUTE');
  }
  const stopForLifecycle = () => {stopScroll();control(null);enqueue('CAPTURE_STOP').catch(()=>{});};
  window.addEventListener('pagehide',()=>{stopScroll();control(null);});
  window.addEventListener('pageshow',event=>{if(event.persisted) stopForLifecycle();});
  window.addEventListener('message',event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel) return;
    if (event.data.type === 'HELLO') {post('READY');if(initialized) control(session);return;}
    if (event.data.type === 'ROUTE_CHANGED') {stopOnNavigation().catch(()=>{});return;}
    if (event.data.type !== 'RESPONSE' || !session || event.data.captureToken !== session.token) return;
    chrome.runtime.sendMessage({type:'CAPTURE_SAVE',captureToken:session.token,context:event.data.context,data:event.data.data,capturedAt:event.data.capturedAt})
      .then(result=>{
        if (!result?.ok) throw Error(result?.error || '后台未确认保存');
        if (result.warning) console.warn('[X-Follow 采集] 请求未返回数据',result.warning.message);
      })
      .catch(async error=>{
        console.error('[X-Follow 采集] 保存失败',error);
        try {await chrome.storage.local.set({captureError:{message:String(error.message),time:new Date().toISOString()}});} catch {}
      });
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if (area === 'session' && changes.captureSessions && session) {
      const valid=Object.values(changes.captureSessions.newValue || {}).some(s=>s.token===session.token);
      if (!valid) control(null);
    }
  });
  // Fallback for route updates not made with the ordinary History APIs.
  setInterval(()=>stopOnNavigation().catch(()=>{}),300);
  post('READY');
})();
