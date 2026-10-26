(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const status=$('record-status'), feedback=$('record-feedback'), preview=$('record-preview');
  const start=$('btn-record-start'), stop=$('btn-record-stop'), exp=$('btn-record-export'), clear=$('btn-record-clear');
  const labels={recording_start:'开始录制',recording_stop:'停止录制',page_open:'打开页面',page_leave:'离开页面',navigation:'页面切换',click:'点击',focus:'聚焦',input:'输入（不含文字）',scroll:'滚动',dialog_open:'打开弹窗',dialog_close:'关闭弹窗'};
  let busy=false;
  async function send(message) {const r=await chrome.runtime.sendMessage(message);if(!r?.ok) throw Error(r?.error || '后台未响应，请重新加载扩展');return r;}
  async function refresh() {
    if(busy) return;
    try {
      const r=await send({type:'RECORD_STATUS'});
      const {operationRecording:log,operationRecordingError:error}=await chrome.storage.local.get(['operationRecording','operationRecordingError']);
      status.textContent=`${r.active?'录制中 · 标签页 '+r.active.tabId:'录制已停止'} · ${r.count} 条日志${r.limited?' · 已达 5000 条上限，请导出后清空':''}`;
      start.disabled=!!r.active || r.limited;stop.disabled=!r.active;exp.disabled=!r.count;clear.disabled=!!r.active || !r.count;
      preview.replaceChildren();
      for(const event of (log?.events || []).slice(-10).reverse()) {
        const item=document.createElement('div');item.className='record-event';
        item.textContent=`${new Date(event.time).toLocaleTimeString('zh-CN',{hour12:false})} ${labels[event.type] || event.type}${event.target?.testId?' · '+event.target.testId:''}${event.target?.label?' · '+event.target.label:''}${event.post?' · 帖子 '+event.post.id:''}${event.type==='scroll'?' · y='+event.y:''}${['navigation','page_open'].includes(event.type)?' · '+event.pageUrl:''}`;
        preview.appendChild(item);
      }
      if(error) feedback.textContent=error;
    } catch(error) {feedback.textContent=error.message;start.disabled=true;stop.disabled=true;}
  }
  async function run(fn) {
    if(busy) return;busy=true;for(const b of [start,stop,exp,clear]) b.disabled=true;
    try{await fn();}catch(error){feedback.textContent=error.message;}finally{busy=false;await refresh();}
  }
  start.addEventListener('click',()=>run(async()=>{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab || !/^https:\/\/(?:x|twitter)\.com\//.test(tab.url || '')) throw Error('请先打开 X 页面');
    // Confirm the page has the updated recorder before starting a session.
    try {const r=await chrome.tabs.sendMessage(tab.id,{type:'RECORD_SYNC'});if(!r?.ok) throw Error();}catch{throw Error('请先刷新 X 页面，再开始录制');}
    await chrome.storage.local.remove('operationRecordingError');
    await send({type:'RECORD_START',tabId:tab.id,pageUrl:tab.url});
    await chrome.tabs.sendMessage(tab.id,{type:'RECORD_SYNC'});
    feedback.textContent='录制已开始，可以关闭面板并操作页面。左下角显示录制提示。';
  }));
  stop.addEventListener('click',()=>run(async()=>{
    const {active}=await send({type:'RECORD_STATUS'});
    if(active) try{await chrome.tabs.sendMessage(active.tabId,{type:'RECORD_FLUSH'});}catch{}
    await send({type:'RECORD_STOP'});
    if(active) try{await chrome.tabs.sendMessage(active.tabId,{type:'RECORD_SYNC'});}catch{}
    feedback.textContent='录制已停止，可以导出操作日志。';
  }));
  exp.addEventListener('click',()=>run(async()=>{
    const {operationRecording:log}=await chrome.storage.local.get('operationRecording');
    if(!log?.events.length) throw Error('暂无日志');
    const url=URL.createObjectURL(new Blob([JSON.stringify({...log,exportedAt:new Date().toISOString()},null,2)],{type:'application/json;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`x-operation-log-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    feedback.textContent='已导出 JSON，包含日志中记录的全部操作。';
  }));
  clear.addEventListener('click',()=>run(async()=>{await send({type:'RECORD_CLEAR'});await chrome.storage.local.remove('operationRecordingError');feedback.textContent='录制日志已清空。';}));
  chrome.storage.onChanged.addListener((changes)=>{if(changes.operationRecording || changes.operationRecordingActive || changes.operationRecordingError) refresh();});
  window.XOperationRecorder={refresh};refresh();
})();
