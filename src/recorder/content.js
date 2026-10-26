/* Records trusted interactions only, in the isolated extension world. */
(() => {
  'use strict';
  let active=null, url=location.href, scrollTimer, inputTimer;
  let dialogs=new Set(), inputPending=null, scrollPending=false;
  const banner=document.createElement('div');
  banner.setAttribute('data-x-operation-recorder','');
  banner.textContent='● 操作录制中';
  banner.style.cssText='position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:8px 12px;border-radius:8px;background:#8c2030;color:white;font:13px sans-serif;pointer-events:none;';
  function setActive(value) {
    const was=active?.token;active=value;
    if(active) {if(!banner.isConnected) (document.body || document.documentElement).appendChild(banner);if(was!==active.token) {dialogs=new Set(document.querySelectorAll('[role="dialog"]'));record('page_open');}}
    else {banner.remove();clearTimeout(scrollTimer);clearTimeout(inputTimer);inputPending=null;scrollPending=false;}
  }
  const cleanUrl=value=>{if(!value) return undefined;try{const u=new URL(value,location.href);return ['x.com','twitter.com'].includes(u.hostname)?u.origin+u.pathname:undefined;}catch{return undefined;}};
  function describe(el) {
    if(!(el instanceof Element)) return {};
    const editable=el.closest('input,textarea,[contenteditable="true"]');
    const sensitive=el.closest('input[type="password"],input[type="email"],input[type="tel"],input[autocomplete="one-time-code"],input[autocomplete="username"],input[autocomplete="current-password"],input[autocomplete="new-password"]');
    if(sensitive) return null;
    const target=el.closest('button,a,input,textarea,[role="button"],[role="textbox"],[contenteditable="true"],[data-testid]') || el;
    const testId=target.getAttribute('data-testid');
    const role=target.getAttribute('role');
    const tag=target.tagName.toLowerCase();
    const selector=testId?`[data-testid="${CSS.escape(testId)}"]`:role?`${tag}[role="${CSS.escape(role)}"]`:tag;
    // Never derive a label from an editable element or one containing an editor.
    const noText=editable || target.querySelector('input,textarea,[contenteditable="true"]');
    const label=noText?'输入区域':(target.getAttribute('aria-label') || target.getAttribute('title') || target.textContent || '').replace(/\s+/g,' ').trim().slice(0,120);
    const article=el.closest('article');
    const permalink=article?.querySelector('a[href*="/status/"]:has(time)') || article?.querySelector('a[href*="/status/"]');
    const postUrl=cleanUrl(permalink?.getAttribute('href'));
    const id=postUrl?.match(/\/status\/(\d+)/)?.[1] || location.pathname.match(/\/status\/(\d+)/)?.[1];
    return {target:{tag,role,testId,label,selector,href:target.hasAttribute('href')?cleanUrl(target.getAttribute('href')):undefined},...(id?{post:{id,url:postUrl || cleanUrl(location.href)}}:{}),dialog:!!el.closest('[role="dialog"]')};
  }
  function record(type,extra={}) {
    if(!active) return;
    const token=active.token;
    return chrome.runtime.sendMessage({type:'RECORD_EVENT',token,event:{type,pageUrl:location.href,...extra}}).then(result=>{
      if(!result?.ok) throw Error(result?.error || '保存未确认');
      if(!result.active && active?.token===token) setActive(null);
    }).catch(error=>{setActive(null);console.error('[X 操作录制]',error);chrome.storage.local.set({operationRecordingError:'操作录制保存失败：'+error.message}).catch(()=>{});banner.textContent='操作录制保存失败，请打开插件检查';banner.style.background='#8c2030';(document.body || document.documentElement).appendChild(banner);});
  }
  for(const [name,type] of [['click','click'],['focusin','focus'],['input','input']]) document.addEventListener(name,event=>{
    if(!active || !event.isTrusted) return;
    const details=describe(event.target);if(!details) return;
    if(name==='input') {clearTimeout(inputTimer);inputPending=details;inputTimer=setTimeout(()=>{inputPending=null;record(type,details);},350);}
    else record(type,{...details,...(name==='click'?{x:event.clientX,y:event.clientY,button:event.button}:{})});
  },true);
  window.addEventListener('scroll',()=>{
    if(!active) return;clearTimeout(scrollTimer);scrollPending=true;scrollTimer=setTimeout(()=>{scrollPending=false;record('scroll',{x:window.scrollX,y:window.scrollY});},400);
  },{passive:true});
  new MutationObserver(()=>{
    if(!active) return;
    const current=new Set(document.querySelectorAll('[role="dialog"]'));
    for(const el of current) if(!dialogs.has(el)) record('dialog_open',{dialog:true});
    for(const el of dialogs) if(!current.has(el)) record('dialog_close',{dialog:false});
    dialogs=current;
  }).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(()=>{if(url!==location.href) {url=location.href;record('navigation');}},300);
  window.addEventListener('pagehide',()=>record('page_leave'));
  const sync=()=>chrome.runtime.sendMessage({type:'RECORD_STATUS'}).then(r=>{if(r?.ok) setActive(r.active);});
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(m?.type==='RECORD_FLUSH') {
      clearTimeout(inputTimer);clearTimeout(scrollTimer);
      const pending=[];
      if(inputPending) pending.push(record('input',inputPending));
      if(scrollPending) pending.push(record('scroll',{x:window.scrollX,y:window.scrollY}));
      inputPending=null;scrollPending=false;
      Promise.all(pending).then(()=>reply({ok:true}));return true;
    }
    if(m?.type!=='RECORD_SYNC') return;
    sync().then(()=>reply({ok:true}),error=>reply({ok:false,error:error.message}));return true;
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session' && changes.operationRecordingActive) {const next=changes.operationRecordingActive.newValue;if(!next || next.token!==active?.token) sync().catch(()=>setActive(null));}});
  sync().catch(()=>{});
})();
