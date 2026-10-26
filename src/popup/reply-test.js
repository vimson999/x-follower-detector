(() => {
  'use strict';
  const single=document.getElementById('btn-reply-test'),triple=document.getElementById('btn-reply-test-three'),stop=document.getElementById('btn-reply-test-stop');
  const configured=document.getElementById('btn-reply-test-configured');
  const countInput=document.getElementById('reply-test-count'),minInput=document.getElementById('reply-test-interval-min'),maxInput=document.getElementById('reply-test-interval-max');
  let formReady=false,uiError=null,pendingRunId=null;
  const readSettings=()=>XReplyTest.validateSettings({count:countInput.valueAsNumber,intervalMinSec:minInput.valueAsNumber,intervalMaxSec:maxInput.valueAsNumber});
  const feedback=document.getElementById('reply-test-status'),preview=document.getElementById('reply-test-preview');
  const labels={finding_next:'向下加载下一条…',reading:'读取帖子…',opening:'进入帖子详情…',reading_wait:'页面已就绪，等待阅读',generating:'模拟请求回复…',filling:'正在回填回复…',prepublish_wait:'已填入，等待发布',checking_account:'识别登录账号…',waiting_button:'等待回复按钮可点击…',confirming:'已点击回复，确认结果…',publishing:'正在发布…',published:'已确认发布',postpublish_wait:'随机间隔等待后返回首页',returning_home:'正在返回首页…',home_ready:'已回到首页',completed:'测试完成',stopped:'已停止测试',uncertain:'发布结果待确认',error:'测试停止'};
  let submitting=false;
  async function render(){
    const {replyTestState:s}=await chrome.storage.local.get('replyTestState');
    if(pendingRunId && s?.runId===pendingRunId) pendingRunId=null;
    const starting=submitting || !!pendingRunId;
    const active=!!s?.active && Date.now()-new Date(s.heartbeatAt || s.updatedAt)<35000;
    single.disabled=starting || active || !formReady;triple.disabled=single.disabled;configured.disabled=single.disabled;stop.disabled=!active;
    for(const input of [countInput,minInput,maxInput]) input.disabled=starting || active || !formReady;
    const seconds=s?.waitUntil?Math.max(0,Math.ceil((new Date(s.waitUntil)-Date.now())/1000)):0;
    feedback.textContent=uiError || (starting?'正在启动本次测试…':s?`第 ${s.itemIndex || 1}/${s.batchTotal || 1} 条 · 已完成 ${s.completedCount || 0} 条 · ${labels[s.state] || s.state}${seconds?'（剩余 '+seconds+' 秒）':''}${s.message?'：'+s.message:''}`:'准备就绪，使用 100 条约 20–40 字、带关注邀请的随机回复；自动排除自己的帖子和回复。');
    preview.textContent=s?.post?`@${s.post.authorHandle}\n${s.post.text}\n${s.post.url}${s.reply?'\n测试回复：'+s.reply:''}`:'';
  }
  async function start(count=null){
    if(submitting) return;submitting=true;single.disabled=true;triple.disabled=true;
    try {
      const values=readSettings();
      const settings=XReplyTest.validateSettings({...values,count:count ?? values.count});
      uiError=null;
      await chrome.storage.local.set({replyTestSettings:values});
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!/^https:\/\/(?:x|twitter)\.com\//.test(tab?.url || '')) throw Error('请打开 X 首页或帖子详情页');
      let r;try{r=await chrome.tabs.sendMessage(tab.id,{type:'REPLY_TEST_START',settings,count:settings.count,tabId:tab.id});}catch{throw Error('请重新加载扩展并刷新 X 页面，再运行测试');}
      if(!r?.ok) throw Error(r?.error || '测试未启动');
      pendingRunId=r.runId;
      feedback.textContent='已启动，可以关闭面板；每一步都会保留诊断。';
    }catch(error){uiError=error.message;feedback.textContent=error.message;}
    finally{submitting=false;await render();}
  }
  configured.addEventListener('click',()=>start());
  for(const input of [countInput,minInput,maxInput]) input.addEventListener('change',async()=>{
    try{const values=readSettings();uiError=null;await chrome.storage.local.set({replyTestSettings:values});}catch(error){uiError=error.message;}
    await render();
  });
  single.addEventListener('click',()=>start(1));triple.addEventListener('click',()=>start(3));
  stop.addEventListener('click',async()=>{
    try{
      const {replyTestState:s}=await chrome.storage.local.get('replyTestState');
      if(!s?.tabId) throw Error('找不到测试所在标签页');
      const r=await chrome.tabs.sendMessage(s.tabId,{type:'REPLY_TEST_STOP'});
      if(!r?.ok) throw Error(r?.error || '停止失败');
      feedback.textContent='已请求停止，不会继续提交或处理下一条。';
    }catch(error){feedback.textContent=error.message;}
  });
  document.getElementById('btn-reply-diagnostics').addEventListener('click',async()=>{
    const {replyTestState:state}=await chrome.storage.local.get('replyTestState');
    if(!state) {feedback.textContent='暂无测试诊断，请先运行一次测试';return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`x-reply-test-${Date.now()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  });
  chrome.storage.onChanged.addListener(changes=>{if(changes.replyTestState) render();});
  setInterval(()=>render().catch(()=>{}),1000);
  (async()=>{
    const {replyTestSettings:saved}=await chrome.storage.local.get('replyTestSettings');
    let values;try{values=XReplyTest.validateSettings(saved || {});}catch{values=XReplyTest.defaultSettings;}
    countInput.value=values.count;minInput.value=values.intervalMinSec;maxInput.value=values.intervalMaxSec;
    formReady=true;await render();
  })().catch(error=>{uiError=error.message;feedback.textContent=error.message;});
})();
