importScripts('../reply/background.js');
importScripts('../recorder/background.js');
/* Serialize capture controls, writes and clears across all browser tabs. */
importScripts('core.js');
let operations = Promise.resolve();
function profile(pageUrl) {
  return XCollector.requestContext('https://x.com/i/api/graphql/capture/UserTweets?variables=%7B%22userId%22%3A%220%22%7D',pageUrl)
    || XCollector.requestContext('https://x.com/i/api/graphql/capture/UserTweetsAndReplies?variables=%7B%22userId%22%3A%220%22%7D',pageUrl);
}
async function handle(message, sender) {
  const sessions = (await chrome.storage.session.get('captureSessions')).captureSessions || {};
  const tabId = sender.tab?.id;
  const session = sessions[tabId];
  if (message.type === 'CAPTURE_START') {
    const p = profile(message.pageUrl);
    if (!p) throw Error('请先打开用户主页的帖子或回复 Tab');
    const next = { token:`${Date.now()}-${Math.random().toString(36).slice(2)}`, handle:p.handle, tab:p.tab, startedAt:new Date().toISOString(), userId:null };
    sessions[tabId] = next;
    await chrome.storage.session.set({captureSessions:sessions});
    return {ok:true,session:next};
  }
  if (message.type === 'CAPTURE_RESTORE') {
    const p = profile(message.pageUrl);
    if (message.reload === true && session && p && session.handle.toLowerCase() === p.handle.toLowerCase()) {
      sessions[tabId] = {...session, tab:p.tab, token:`${Date.now()}-${Math.random().toString(36).slice(2)}`};
    } else delete sessions[tabId];
    await chrome.storage.session.set({captureSessions:sessions});
    return {ok:true,session:sessions[tabId] || null};
  }
  if (message.type === 'CAPTURE_ROUTE') {
    const p = profile(message.pageUrl);
    if (session && p && session.handle.toLowerCase() === p.handle.toLowerCase()) {
      session.tab = p.tab;
    } else delete sessions[tabId];
    await chrome.storage.session.set({captureSessions:sessions});
    return {ok:true,session:sessions[tabId] || null};
  }
  if (message.type === 'CAPTURE_STOP') {
    delete sessions[tabId];
    await chrome.storage.session.set({captureSessions:sessions});
    return {ok:true,session:null};
  }
  if (message.type === 'CAPTURE_STATUS') return {ok:true,session:session || null};
  if (message.type === 'CAPTURE_CLEAR') {
    if (!/^capture:\d+:(posts|replies)$/.test(message.key || '')) throw Error('无效的清空目标');
    const stored = await chrome.storage.local.get('captureIndex');
    const index = stored.captureIndex || {};
    const entry = index[message.key];
    if (entry) for (const [id,s] of Object.entries(sessions)) {
      if (s.userId === entry.owner.id || s.handle.toLowerCase() === entry.owner.handle.toLowerCase()) delete sessions[id];
    }
    // Revoke sessions before deleting so delayed responses cannot refill data.
    await chrome.storage.session.set({captureSessions:sessions});
    delete index[message.key];
    await chrome.storage.local.remove(message.key);
    await chrome.storage.local.set({captureIndex:index,captureError:null});
    return {ok:true};
  }
  const c = message.context;
  if (!session || message.captureToken !== session.token) return {ok:true,ignored:true};
  if (!c || session.handle.toLowerCase() !== String(c.handle).toLowerCase()) return {ok:true,ignored:true};
  const capturedAt = new Date(message.capturedAt);
  if (!/^\d+$/.test(c.userId || '') || !/^[a-zA-Z0-9_]{1,15}$/.test(c.handle || '') || isNaN(capturedAt)) throw Error('无效的采集数据');
  const synthetic = `https://x.com/i/api/graphql/capture/${c.operation}?variables=${encodeURIComponent(JSON.stringify({userId:c.userId}))}`;
  if (!XCollector.requestContext(synthetic,c.pageUrl)) throw Error('无效的用户时间线来源');
  if (session.userId && session.userId !== c.userId) return {ok:true,ignored:true};
  // A rejected request contains no timeline to save; it is not a disk write failure.
  const status=message.data?.httpStatus;
  if (Number.isInteger(status) && status>=400 && status<=599) {
    const warning={kind:status===429?'rate_limit':'request',status,time:capturedAt.toISOString(),
      message:status===429?'X 时间线请求被限流（HTTP 429）。本次没有返回帖子，已保存数据保留。请先停止滚动，稍后再试，避免连续刷新。':`X 时间线请求失败（HTTP ${status}），本次未返回可采集数据，已保存数据保留。`};
    await chrome.storage.local.set({captureError:warning});
    return {ok:true,warning};
  }
  const batch = XCollector.parseBatch(c,message.data,capturedAt.toISOString());
  if (!message.data?.data?.user?.result || message.data.errors?.length && !batch.items.length) throw Error(message.data?.errors?.map(e=>String(e.message || '接口错误')).join('; ') || '时间线接口返回错误，请重试');
  const user = message.data.data.user.result;
  const timeline = user.timeline_v2?.timeline || user.timeline?.timeline || user.timeline;
  if (!Array.isArray(timeline?.instructions)) throw Error('时间线响应结构不兼容：未找到 instructions，未保存空数据');
  session.responses = (session.responses || 0) + 1;
  session.parsedItems = (session.parsedItems || 0) + batch.items.length;
  session.lastBatchCount = batch.items.length;
  session.lastOperation = c.operation;
  session.lastPageEmpty = batch.items.length === 0;
  session.terminated = batch.terminated;
  session.userId = c.userId;
  await chrome.storage.session.set({captureSessions:sessions});
  const key = XCollector.bucketKey(batch);
  const stored = await chrome.storage.local.get(key);
  const bucket = XCollector.mergeBucket(stored[key],batch);
  const data = await chrome.storage.local.get('captureIndex');
  const index = data.captureIndex || {};
  index[key] = {owner:bucket.owner,tab:bucket.tab,count:Object.keys(bucket.items).length,
    firstCapturedAt:bucket.firstCapturedAt,lastCapturedAt:bucket.lastCapturedAt,pageCount:bucket.pageCount};
  await chrome.storage.local.set({[key]:bucket,captureIndex:index,captureError:null});
  return {ok:true,count:index[key].count};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  if (!['CAPTURE_RESTORE','CAPTURE_START','CAPTURE_STOP','CAPTURE_STATUS','CAPTURE_ROUTE','CAPTURE_CLEAR','CAPTURE_SAVE'].includes(message?.type)) return;
  const popup = sender.url === `chrome-extension://${chrome.runtime.id}/src/popup/index.html`;
  const page = sender.tab && /^https:\/\/(?:x|twitter)\.com\//.test(sender.url || '');
  if (sender.id !== chrome.runtime.id || (message.type === 'CAPTURE_CLEAR' ? !popup : !page)) {
    sendResponse({ok:false,error:'无效的采集来源'});return;
  }
  operations = operations.catch(()=>{}).then(()=>handle(message,sender));
  operations.then(sendResponse,async error => {
    const text = String(error.message || error);
    if (message.type === 'CAPTURE_SAVE') try { await chrome.storage.local.set({captureError:{message:text,time:new Date().toISOString()}}); } catch {}
    sendResponse({ok:false,error:text});
  });
  return true;
});
