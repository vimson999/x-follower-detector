(() => {
  'use strict';
  // Keep existing storage keys and message names so saved settings remain usable.
  const startButton=document.getElementById('btn-reply-test-configured'),stopButton=document.getElementById('btn-reply-test-stop');
  const exportButton=document.getElementById('btn-reply-diagnostics');
  const countInput=document.getElementById('reply-test-count'),minInput=document.getElementById('reply-test-interval-min'),maxInput=document.getElementById('reply-test-interval-max');
  const apiKeyInput=document.getElementById('reply-gemini-key');
  const feedback=document.getElementById('reply-test-status'),preview=document.getElementById('reply-test-preview'),progress=document.getElementById('reply-progress');
  const diagnosticStatus=document.getElementById('reply-diagnostics-status'),diagnosticFeedback=document.getElementById('reply-diagnostics-feedback');
  document.getElementById('reply-pool-size').textContent='Gemini AI 驱动 · 预制库已封存';
  const labels={finding_next:'向下加载下一条…',reading:'读取帖子…',opening:'进入帖子详情…',reading_wait:'页面已就绪，等待阅读',generating:'选择回复话术…',filling:'正在回填回复…',prepublish_wait:'已填入，等待发布',checking_account:'识别登录账号…',waiting_button:'等待回复按钮可点击…',confirming:'已点击回复，确认结果…',publishing:'正在发布…',published:'已确认发布',postpublish_wait:'随机等待后返回首页',returning_home:'正在返回首页…',home_ready:'已回到首页',completed:'回复完成',stopped:'已停止回复',uncertain:'发布结果待确认',error:'任务停止'};
  let formReady=false,uiError=null,pendingRunId=null,submitting=false;
  const inputs=[countInput,minInput,maxInput];
  const readSettings=()=>XReplyTest.validateSettings({count:countInput.valueAsNumber,intervalMinSec:minInput.valueAsNumber,intervalMaxSec:maxInput.valueAsNumber});
  function lockSettings(locked) {startButton.disabled=locked;for(const input of inputs) input.disabled=locked;if(apiKeyInput) apiKeyInput.disabled=locked;}
  async function render(){
    const {replyTestState:s}=await chrome.storage.local.get('replyTestState');
    if(pendingRunId && s?.runId===pendingRunId) pendingRunId=null;
    const starting=submitting || !!pendingRunId;
    const active=!!s?.active && Date.now()-new Date(s.heartbeatAt || s.updatedAt)<35000;
    lockSettings(starting || active || !formReady);stopButton.disabled=!active;
    const waiting=active && ['reading_wait','prepublish_wait','postpublish_wait'].includes(s.state);
    const seconds=waiting && s.waitUntil?Math.max(0,Math.ceil((new Date(s.waitUntil)-Date.now())/1000)):0;
    feedback.textContent=uiError || (starting?'正在启动回复任务…':s?`第 ${s.itemIndex || 1}/${s.batchTotal || 1} 条 · 已完成 ${s.completedCount || 0} 条 · ${labels[s.state] || s.state}${seconds?'（剩余 '+seconds+' 秒）':''}${s.message?'：'+s.message:''}`:'准备就绪，设置数量和等待范围后开始。');
    feedback.dataset.tone=uiError || ['error','uncertain'].includes(s?.state)?'error':active?'active':s?.state==='completed'?'success':'idle';
    progress.max=s?.batchTotal || countInput.valueAsNumber || XReplyTest.defaultSettings.count;
    progress.value=s?.completedCount || 0;
    preview.textContent=s?.post?`@${s.post.authorHandle}\n${s.post.text}\n${s.post.url}${s.reply?'\n\n回复内容：'+s.reply:''}`:'运行后，这里会显示当前帖子和选中的回复。';
    exportButton.disabled=!s;
    diagnosticStatus.textContent=s?`${labels[s.state] || s.state} · 已完成 ${s.completedCount || 0}/${s.batchTotal || 1} 条 · ${new Date(s.updatedAt).toLocaleString('zh-CN',{hour12:false})}`:'尚无回复任务记录';
  }
  async function start(){
    if(submitting) return;
    submitting=true;lockSettings(true);stopButton.disabled=true;
    try {
      const keyVal = apiKeyInput?.value?.trim();
      if(keyVal) {
        await chrome.storage.local.set({ geminiApiKey: keyVal });
      } else {
        const stored = await chrome.storage.local.get('geminiApiKey');
        if(!stored?.geminiApiKey) throw Error('请先在下方填入 Gemini API Key');
      }
      const settings=readSettings();uiError=null;
      await chrome.storage.local.set({replyTestSettings:settings});
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!/^https:\/\/(?:x|twitter)\.com\//.test(tab?.url || '')) throw Error('请打开 X 首页、搜索结果页或帖子详情页');
      let r;
      try{r=await chrome.tabs.sendMessage(tab.id,{type:'REPLY_TEST_START',settings,count:settings.count,tabId:tab.id});}catch{throw Error('请重新加载扩展并刷新 X 页面，再开始回复');}
      if(!r?.ok) throw Error(r?.error || '回复任务未启动');
      pendingRunId=r.runId;
      diagnosticFeedback.textContent='';
    }catch(error){uiError=error.message;}
    finally{submitting=false;await render();}
  }
  startButton.addEventListener('click',start);
  for(const input of inputs) input.addEventListener('change',async()=>{
    try{const values=readSettings();uiError=null;await chrome.storage.local.set({replyTestSettings:values});}catch(error){uiError=error.message;}
    await render();
  });
  if(apiKeyInput) {
    const saveKey = async () => {
      const val = apiKeyInput.value.trim();
      if(val) await chrome.storage.local.set({ geminiApiKey: val });
    };
    apiKeyInput.addEventListener('input', saveKey);
    apiKeyInput.addEventListener('change', saveKey);
  }
  stopButton.addEventListener('click',async()=>{
    try{
      const {replyTestState:s}=await chrome.storage.local.get('replyTestState');
      if(!s?.tabId) throw Error('找不到回复任务所在标签页');
      const r=await chrome.tabs.sendMessage(s.tabId,{type:'REPLY_TEST_STOP'});
      if(!r?.ok) throw Error(r?.error || '停止失败');
      uiError=null;feedback.textContent='已请求停止，不会继续提交或处理下一条。';
    }catch(error){uiError=error.message;feedback.textContent=error.message;}
  });
  exportButton.addEventListener('click',async()=>{
    try{
      const {replyTestState:state}=await chrome.storage.local.get('replyTestState');
      if(!state) throw Error('尚无诊断记录，请先运行回复任务');
      const url=URL.createObjectURL(new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download=`x-reply-diagnostics-${Date.now()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      diagnosticFeedback.textContent='已导出最近一次回复任务诊断。';
    }catch(error){diagnosticFeedback.textContent=error.message;}
  });
  chrome.storage.onChanged.addListener(changes=>{if(changes.replyTestState) render().catch(()=>{});});
  setInterval(()=>render().catch(()=>{}),1000);
  (async()=>{
    const {replyTestSettings:saved,geminiApiKey:savedKey}=await chrome.storage.local.get(['replyTestSettings','geminiApiKey']);
    let values;try{values=XReplyTest.validateSettings(saved || {});}catch{values=XReplyTest.defaultSettings;}
    countInput.value=values.count;minInput.value=values.intervalMinSec;maxInput.value=values.intervalMaxSec;
    if(apiKeyInput && savedKey) apiKeyInput.value = savedKey;
    formReady=true;await render();
  })().catch(error=>{uiError=error.message;feedback.textContent=error.message;});
})();
