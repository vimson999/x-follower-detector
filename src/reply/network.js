/* Diagnostic metadata only: no additional requests, headers or request/response bodies. */
(() => {
  'use strict';
  const channel='X_REPLY_DIAGNOSTICS_V1';
  let active=null,seq=0;
  window.addEventListener('message',event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.channel!==channel) return;
    const m=event.data;
    if(m.type==='START' && typeof m.runId==='string') {
      active={id:m.runId,until:Date.now()+Math.min(300000,Math.max(90000,Number(m.maxDurationMs) || 90000)),count:0,maxRequests:Math.min(5000,Math.max(200,Number(m.maxRequests) || 200))};
      window.postMessage({channel,type:'READY',runId:active.id},location.origin);
    }
    if(m.type==='HEARTBEAT' && m.runId===active?.id) active.until=Date.now()+90000;
    if(m.type==='STOP' && m.runId===active?.id) active=null;
  });
  function context(url,method) {
    if(!active || Date.now()>active.until || active.count>=active.maxRequests) return null;
    try {
      const u=new URL(url,location.href);
      const operation=u.pathname.match(/\/graphql\/[^/]+\/(HomeTimeline|HomeLatestTimeline|TweetDetail|CreateTweet)$/)?.[1];
      if(u.protocol!=='https:' || !['x.com','twitter.com'].includes(u.hostname) || !operation) return null;
      active.count++;
      return {requestId:++seq,operation,url:u.origin+u.pathname,method:String(method || 'GET').toUpperCase(),runId:active.id,startedAt:Date.now()};
    }catch{return null;}
  }
  function emit(c,phase,status) {
    if(!c || active?.id!==c.runId) return;
    const event={requestId:c.requestId,operation:c.operation,url:c.url,method:c.method,phase,time:new Date().toISOString(),elapsedMs:Date.now()-c.startedAt};
    if(Number.isFinite(status)) event.status=status;
    window.postMessage({channel,type:'NETWORK',runId:c.runId,event},location.origin);
  }
  const originalFetch=window.fetch;
  window.fetch=function(...args){
    const [input,init]=args;
    const c=context(typeof input==='string' || input instanceof URL?String(input):input?.url,init?.method || input?.method);
    emit(c,'started');
    let promise;
    try{promise=originalFetch.apply(this,args);}catch(error){emit(c,'failed');throw error;}
    if(c) promise.then(response=>emit(c,'completed',response.status),()=>emit(c,'failed'));
    return promise;
  };
  const proto=XMLHttpRequest.prototype,open=proto.open,send=proto.send,requests=new WeakMap();
  proto.open=function(method,url,...args){requests.set(this,{method,url:String(url)});return open.call(this,method,url,...args);};
  proto.send=function(...args){
    const request=requests.get(this),c=request && context(request.url,request.method);
    if(c){emit(c,'started');this.addEventListener('loadend',()=>{if(requests.get(this)===request)emit(c,this.status?'completed':'failed',this.status);},{once:true});}
    try{return send.apply(this,args);}catch(error){emit(c,'failed');throw error;}
  };
})();
