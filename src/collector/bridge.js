/* ISOLATED world: manual controls and response relay. New documents start off. */
(() => {
  'use strict';
  if (globalThis.__xFollowCaptureBridge) return;
  globalThis.__xFollowCaptureBridge = true;
  const channel = 'X_FOLLOW_CAPTURE_V1';
  let session = null;
  let currentUrl = location.href;
  const post = (type,extra={}) => window.postMessage({channel,type,...extra},location.origin);
  const control = value => { session=value;post('CONTROL',{session}); };
  async function command(type) {
    const result = await chrome.runtime.sendMessage({type,pageUrl:location.href});
    if (!result?.ok) throw Error(result?.error || '后台未响应');
    control(result.session || null);
    return result;
  }
  // Controls are serialized with initial reset and navigation stops.
  let controls = command('CAPTURE_STOP').catch(()=>{});
  function enqueue(type) { const next=controls.catch(()=>{}).then(()=>command(type));controls=next;return next; }
  chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
    if (!['CAPTURE_START','CAPTURE_STOP','CAPTURE_STATUS'].includes(message?.type)) return;
    enqueue(message.type).then(result=>sendResponse({...result,pageUrl:location.href}),error=>sendResponse({ok:false,error:error.message}));
    return true;
  });
  async function stopOnNavigation() {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    control(null);
    await enqueue('CAPTURE_STOP');
  }
  const stopForLifecycle = () => {control(null);enqueue('CAPTURE_STOP').catch(()=>{});};
  window.addEventListener('pagehide',stopForLifecycle);
  window.addEventListener('pageshow',event=>{if(event.persisted) stopForLifecycle();});
  window.addEventListener('message',event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel) return;
    if (event.data.type === 'HELLO') {post('READY');control(session);return;}
    if (event.data.type === 'ROUTE_CHANGED') {stopOnNavigation().catch(()=>{});return;}
    if (event.data.type !== 'RESPONSE' || !session || event.data.captureToken !== session.token) return;
    chrome.runtime.sendMessage({type:'CAPTURE_SAVE',captureToken:session.token,context:event.data.context,data:event.data.data,capturedAt:event.data.capturedAt})
      .then(result=>{if (!result?.ok) throw Error(result?.error || '后台未确认保存');})
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
