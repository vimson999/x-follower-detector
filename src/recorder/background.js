/* Operation recording uses its own queue and explicit per-tab authorization. */
(() => {
  'use strict';
  let queue=Promise.resolve();
  const LIMIT=5000;
  const clean=(s,n=160)=>typeof s==='string'?s.slice(0,n):undefined;
  const pageUrl=value=>{try {const u=new URL(value);return u.protocol==='https:' && ['x.com','twitter.com'].includes(u.hostname)?u.origin+u.pathname:null;}catch{return null;}};
  function eventData(event) {
    if (!['click','focus','input','scroll','navigation','page_open','page_leave','dialog_open','dialog_close'].includes(event?.type)) throw Error('不支持的录制事件');
    const result={type:event.type,pageUrl:pageUrl(event.pageUrl)};
    if(event.target) {
      result.target={};
      for(const k of ['tag','role','testId','label','selector']) {const v=clean(event.target[k],k==='selector'?400:120);if(v!==undefined) result.target[k]=v;}
      const link=pageUrl(event.target.href);if(link) result.target.href=link;
    }
    if (/^\d+$/.test(event.post?.id || '')) result.post={id:event.post.id,url:pageUrl(event.post.url)};
    for(const k of ['x','y','button']) if(Number.isFinite(event[k])) result[k]=Math.round(event[k]);
    if(typeof event.dialog==='boolean') result.dialog=event.dialog;
    return result;
  }
  async function handle(m,sender,popup) {
    let active=(await chrome.storage.session.get('operationRecordingActive')).operationRecordingActive || null;
    const log=(await chrome.storage.local.get('operationRecording')).operationRecording;
    if(m.type==='RECORD_STATUS') return {ok:true,active:popup || active?.tabId===sender.tab.id?active:null,count:log?.events.length || 0,limited:!!log?.limited};
    if(m.type==='RECORD_CLEAR') {
      if(active) throw Error('请先停止录制再清空日志');
      await chrome.storage.local.remove('operationRecording');return {ok:true};
    }
    if(m.type==='RECORD_START') {
      if(active) throw Error('已有录制正在进行，请先停止');
      if(!Number.isInteger(m.tabId) || !pageUrl(m.pageUrl)) throw Error('请在 X 页面开始录制');
      if(log?.events.length>=LIMIT) throw Error('日志已满，请先导出并清空');
      active={tabId:m.tabId,token:`${Date.now()}-${Math.random().toString(36).slice(2)}`,startedAt:new Date().toISOString()};
    }
    if(m.type==='RECORD_EVENT' && (!active || active.tabId!==sender.tab.id || active.token!==m.token)) return {ok:true,ignored:true};
    if(m.type==='RECORD_STOP' && !active) return {ok:true,active:null};
    const now=new Date().toISOString();
    const recording=log || {schemaVersion:1,createdAt:now,description:'X 操作日志；不含输入文字、密码、Cookie、认证信息或鼠标移动轨迹',events:[]};
    if(recording.events.length>=LIMIT) {
      await chrome.storage.session.remove('operationRecordingActive');return {ok:true,active:null,limited:true};
    }
    const event=m.type==='RECORD_START'?{type:'recording_start',pageUrl:pageUrl(m.pageUrl)}:m.type==='RECORD_STOP'?{type:'recording_stop'}:eventData(m.event);
    recording.events.push({...event,sequence:recording.events.length+1,time:now,tabId:active.tabId,segment:active.startedAt});
    recording.updatedAt=now;
    recording.limited=recording.events.length>=LIMIT;
    await chrome.storage.local.set({operationRecording:recording});
    if(m.type==='RECORD_STOP' || recording.limited) {active=null;await chrome.storage.session.remove('operationRecordingActive');}
    else if(m.type==='RECORD_START') await chrome.storage.session.set({operationRecordingActive:active});
    return {ok:true,active,count:recording.events.length,limited:recording.limited};
  }
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(!['RECORD_START','RECORD_STOP','RECORD_STATUS','RECORD_CLEAR','RECORD_EVENT'].includes(m?.type)) return;
    const popup=sender.url===`chrome-extension://${chrome.runtime.id}/src/popup/index.html`;
    const page=sender.tab && /^https:\/\/(?:x|twitter)\.com\//.test(sender.url || '');
    if(sender.id!==chrome.runtime.id || (m.type==='RECORD_EVENT'?!page:m.type==='RECORD_STATUS'?!(page || popup):!popup)) {reply({ok:false,error:'无效的录制来源'});return;}
    queue=queue.catch(()=>{}).then(()=>handle(m,sender,popup));
    queue.then(reply,error=>reply({ok:false,error:String(error.message || error)}));return true;
  });
})();
