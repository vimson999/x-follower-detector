/* Exportable, bounded snapshots of the live DOM, never executable page source. */
(() => {
  'use strict';
  const pageUrl=value=>{try{const u=new URL(value,location.href);return ['x.com','twitter.com'].includes(u.hostname)?u.origin+u.pathname:null;}catch{return null;}};
  function describe(el) {
    if(!el) return null;
    const r=el.getBoundingClientRect(),style=getComputedStyle(el);
    const x=Math.max(0,Math.min(innerWidth-1,r.x+r.width/2)),y=Math.max(0,Math.min(innerHeight-1,r.y+r.height/2));
    const hit=document.elementFromPoint(x,y);
    return {tag:el.tagName.toLowerCase(),testId:el.getAttribute('data-testid'),role:el.getAttribute('role'),
      connected:el.isConnected,visible:!!el.getClientRects().length && style.display!=='none' && style.visibility!=='hidden',
      disabled:!!el.disabled,ariaDisabled:el.getAttribute('aria-disabled'),contentEditable:el.isContentEditable,
      textLength:el.isContentEditable?(el.innerText || '').trim().length:undefined,focused:document.activeElement===el,
      rect:{x:r.x,y:r.y,width:r.width,height:r.height},pointerEvents:style.pointerEvents,covered:!!hit && hit!==el && !el.contains(hit)};
  }
  function html(root,limit) {
    const allowed=new Set(['id','class','role','data-testid','aria-label','aria-disabled','aria-hidden','disabled','contenteditable','tabindex','type','datetime']);
    const skip=new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','IFRAME','OBJECT','EMBED','SVG','CANVAS','META','LINK']);
    let size=0,nodes=0,truncated=false;
    const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const add=s=>{const remaining=limit-size;if(s.length>remaining) truncated=true;const part=s.slice(0,Math.max(0,remaining));size+=part.length;return part;};
    function walk(node) {
      if(size>=limit || ++nodes>6000){truncated=true;return '';}
      if(node.nodeType===3) return add(escape(node.nodeValue || ''));
      if(node.nodeType!==1 || skip.has(node.tagName) || node.hasAttribute('data-x-reply-test-status') || node.hasAttribute('data-x-operation-recorder')) return '';
      const tag=node.tagName.toLowerCase();
      let attrs='';
      for(const a of node.attributes) if(allowed.has(a.name)) attrs+=` ${a.name}="${escape(a.value.slice(0,500))}"`;
      if(node.hasAttribute('href')) {const url=pageUrl(node.getAttribute('href'));if(url)attrs+=` href="${escape(url)}"`;}
      let out=add(`<${tag}${attrs}>`);
      if(['INPUT','TEXTAREA','SELECT'].includes(node.tagName) || node.isContentEditable || node.getAttribute('role')==='textbox') out+=add('[INPUT_REDACTED]');
      else for(const child of node.childNodes) out+=walk(child);
      return out+add(`</${tag}>`);
    }
    return {html:root?walk(root):'',truncated,characters:size,nodes};
  }
  function create(runId,{count=1}={}) {
    const maxSnapshots=count*30+8,normalLimit=Math.min(80000,Math.max(3000,Math.floor(6000000/maxSnapshots)));
    const snapshots=[],network=[],exceptions=[];
    const maxNetworkEvents=Math.min(5000,Math.max(400,count*40+50));
    let ready=false;
    const snapshot=(stage,context={})=>{
      const selectorMap={posts:'article[data-testid="tweet"]',editors:'[contenteditable="true"][data-testid^="tweetTextarea_"]',publishButtons:'[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',dialogs:'[role="dialog"]',accountLinks:'[data-testid="AppTabBar_Profile_Link"]'};
      const locators={};
      for(const [key,selector] of Object.entries(selectorMap)) {const all=[...document.querySelectorAll(selector)];locators[key]={selector,count:all.length,matches:all.slice(0,8).map(describe)};}
      const failure=['error','uncertain'].includes(stage);
      const root=failure?document.body:document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main') || document.body;
      const snap={...context,stage,time:new Date().toISOString(),pageUrl:pageUrl(location.href),viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},activeElement:describe(document.activeElement),locators,scope:failure?'body':'primaryColumn/main/body',dom:html(root,failure?160000:normalLimit)};
      if(snapshots.length<maxSnapshots) snapshots.push(snap);else if(failure)snapshots[snapshots.length-1]=snap;
    };
    return {snapshot,addNetwork:event=>{if(network.length<maxNetworkEvents)network.push(event);},addException:error=>{if(exceptions.length<30)exceptions.push(error);},markReady:()=>{ready=true;},
      export:()=>({schemaVersion:2,runId,capturePolicy:{inputText:'redacted',scripts:'excluded',requestHeaders:'excluded',requestBodies:'excluded',responseBodies:'excluded',urlQueries:'excluded',maxSnapshots,normalSnapshotCharLimit:normalLimit},environment:{extensionVersion:chrome.runtime.getManifest().version,userAgent:navigator.userAgent},networkObserverReady:ready,snapshots,network,exceptions})};
  }
  globalThis.XReplyDiagnostics={create};
})();
