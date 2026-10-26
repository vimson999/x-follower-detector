/* Reserve a target before the publish click. Never retry an uncertain submission. */
(() => {
  let queue=Promise.resolve();
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(!['REPLY_TEST_CLAIM','REPLY_TEST_CONFIRMED'].includes(m?.type)) return;
    if(sender.id!==chrome.runtime.id || !sender.tab || !/^https:\/\/(?:x|twitter)\.com\//.test(sender.url || '') || !/^\d+$/.test(m.postId || '')) {
      reply({ok:false,error:'无效的回复测试来源'});return;
    }
    queue=queue.catch(()=>{}).then(async()=>{
      const {replyTestClaims:claims={}}=await chrome.storage.local.get('replyTestClaims');
      if(m.type==='REPLY_TEST_CONFIRMED') {
        const claim=claims[m.postId];
        if(!claim || claim.runId!==m.runId || claim.tabId!==sender.tab.id || !/^\d+$/.test(m.replyId || '') || m.replyId===m.postId || !/^[a-zA-Z0-9_]{1,15}$/.test(m.account || '')) return {ok:false,error:'自身回复记录与本次提交不匹配'};
        const {replyTestOwnReplies:ownReplies={}}=await chrome.storage.local.get('replyTestOwnReplies');
        ownReplies[m.replyId]={account:m.account.toLowerCase(),parentId:m.postId,runId:m.runId,time:new Date().toISOString()};
        claim.confirmedReplyId=m.replyId;
        await chrome.storage.local.set({replyTestOwnReplies:ownReplies,replyTestClaims:claims});
        return {ok:true};
      }
      if(claims[m.postId]) return {ok:false,error:'此帖子已提交过测试回复，不会重复发布；请先到 X 检查结果'};
      claims[m.postId]={runId:m.runId,time:new Date().toISOString(),tabId:sender.tab.id};
      await chrome.storage.local.set({replyTestClaims:claims});
      return {ok:true};
    });
    queue.then(reply,error=>reply({ok:false,error:error.message}));return true;
  });
})();
