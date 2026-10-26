/* Uses textContent for API-provided user names; no remote HTML is rendered. */
(() => {
  'use strict';
  const labels = { posts: '帖子', replies: '回复' };
  const list = document.getElementById('collection-list');
  const feedback = document.getElementById('capture-feedback');
  const startButton = document.getElementById('btn-capture-start');
  const stopButton = document.getElementById('btn-capture-stop');
  const target = document.getElementById('capture-target');
  const scrollStart = document.getElementById('btn-scroll-start');
  const scrollStop = document.getElementById('btn-scroll-stop');
  const scrollStatus = document.getElementById('scroll-status');
  let controlBusy = false;
  const date = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  async function download(key, button) {
    button.disabled = true;
    try {
      const data = await chrome.storage.local.get(key);
      const bucket = data[key];
      if (!bucket) throw new Error('未找到采集数据，请刷新列表');
      const now = new Date();
      const filename = XCollector.exportFilename(bucket, now);
      const blob = new Blob([JSON.stringify(XCollector.exportBucket(bucket, now.toISOString()), null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      feedback.textContent = `已发起导出：${filename}`;
      feedback.classList.remove('capture-error');
    } catch (error) {
      feedback.textContent = `导出失败：${error.message}`;
      feedback.classList.add('capture-error');
    } finally { button.disabled = false; }
  }
  function showError(error) {
    feedback.textContent = error.message;
    feedback.classList.add('capture-error');
  }
  async function current() {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab) throw Error('没有可用的浏览器页面');
    const result = await chrome.tabs.sendMessage(tab.id,{type:'CAPTURE_STATUS'});
    if (!result?.ok) throw Error(result?.error || '请刷新 X 页面后再试');
    const url = result.pageUrl;
    const p = XCollector.requestContext('https://x.com/i/api/graphql/capture/UserTweets?variables=%7B%22userId%22%3A%220%22%7D',url)
      || XCollector.requestContext('https://x.com/i/api/graphql/capture/UserTweetsAndReplies?variables=%7B%22userId%22%3A%220%22%7D',url);
    return {tab,result,profile:p};
  }
  async function refreshControls() {
    if (controlBusy) return;
    startButton.disabled = true;stopButton.disabled = true;scrollStart.disabled=true;scrollStop.disabled=true;
    try {
      const state = await current();
      if (controlBusy) return;
      if (!state.profile) {target.textContent='请打开用户主页的帖子或回复 Tab';return;}
      const active = !!state.result.session;
      scrollStart.disabled = !!state.result.scrolling;
      scrollStop.disabled = !state.result.scrolling;
      scrollStatus.textContent = state.result.scrolling ? '自动滚动中（每 2.5 秒向下一段）' : '滚动已停止';
      target.textContent = `${active ? '采集中' : '已停止'}：@${state.profile.handle} · ${labels[state.profile.tab]}`;
      if (active) target.textContent += ` · 收到 ${state.result.session.responses || 0} 次响应，解析 ${state.result.session.parsedItems || 0} 条（含重复）${state.result.session.responses ? '' : '；等待新的时间线请求，请向下滚动加载，缓存内容不会补采'}`;
      if (active && state.result.session.lastPageEmpty) target.textContent += state.result.session.terminated ? '；接口已返回列表末尾，本次没有帖子' : '；最近响应没有帖子内容';
      startButton.disabled = active;stopButton.disabled = !active;
    } catch (error) {target.textContent=`无法连接采集脚本：${error.message}。请刷新 X 网页后重试。`;}
  }
  async function runControl(type) {
    if (controlBusy) return;
    controlBusy = true;startButton.disabled = true;stopButton.disabled = true;
    try {
      const state = await current();
      const result = await chrome.tabs.sendMessage(state.tab.id,{type});
      if (!result?.ok) throw Error(result?.error || '操作失败');
      feedback.classList.remove('capture-error');
      feedback.textContent = {CAPTURE_START:'采集已开始。可以手动浏览、切换帖子/回复，或另行开始滚动。', CAPTURE_STOP:'采集已停止，滚动状态不变。已保存的数据可在下方导出。', SCROLL_START:'滚动已开始，采集状态不变。', SCROLL_STOP:'滚动已停止，采集状态不变。'}[type];
    } catch (error) {showError(error);}
    finally {controlBusy=false;await refreshControls();}
  }
  async function clearBucket(key,entry,button) {
    if (!confirm(`清空 @${entry.owner.handle} 的${labels[entry.tab]}数据？此操作会停止该分类的采集，其他数据保留。`)) return;
    button.disabled=true;
    try {
      const result = await chrome.runtime.sendMessage({type:'CAPTURE_CLEAR',key});
      if (!result?.ok) throw Error(result?.error || '清空失败');
      await refresh();
      feedback.textContent='已清空该用户的该 Tab 数据，并停止相应采集。';
    } catch(error) {showError(error);}
    finally {button.disabled=false;}
  }
  let refreshVersion = 0;
  async function refresh() {
    const version = ++refreshVersion;
    refreshControls();
    try {
      const data = await chrome.storage.local.get(['captureIndex', 'captureError']);
      if (version !== refreshVersion) return;
      list.replaceChildren();
      const error=data.captureError;
      feedback.textContent = error
        ? ['rate_limit','request'].includes(error.kind)
          ? `最近请求提示（${date(error.time)}）：${error.message}`
          : `最近保存失败（${date(error.time)}）：${error.message}。请检查扩展错误后重试。`
        : '';
      feedback.classList.toggle('capture-error', !!data.captureError);
      const entries = Object.entries(data.captureIndex || {}).sort((a,b) => b[1].lastCapturedAt.localeCompare(a[1].lastCapturedAt));
      if (!entries.length) {
        list.appendChild(node('p','capture-empty','暂无数据。在用户的帖子或回复页面点击「开始采集」，再向下滚动加载。'));
        return;
      }
      for (const [key, entry] of entries) {
        const card = node('section','capture-card');
        card.appendChild(node('h3','capture-owner', `${entry.owner.name ? entry.owner.name + ' ' : ''}@${entry.owner.handle}`));
        card.appendChild(node('p','capture-meta', `用户 ID：${entry.owner.id} · ${labels[entry.tab] || entry.tab}`));
        card.appendChild(node('p','capture-count', `${entry.count} 条 · ${entry.pageCount} 次接口记录`));
        card.appendChild(node('p','capture-meta', `首次采集：${date(entry.firstCapturedAt)}`));
        card.appendChild(node('p','capture-meta', `最近采集：${date(entry.lastCapturedAt)}`));
        const button = node('button','capture-export', `导出${labels[entry.tab] || entry.tab} JSON`);
        button.type = 'button';
        button.addEventListener('click', () => download(key, button));
        const actions = node('div','capture-actions');
        actions.appendChild(button);
        const clear = node('button','capture-export capture-clear','清空');
        clear.type='button';clear.addEventListener('click',()=>clearBucket(key,entry,clear));
        actions.appendChild(clear);card.appendChild(actions);
        list.appendChild(card);
      }
    } catch (error) {
      feedback.textContent = `读取失败：${error.message}`;
      feedback.classList.add('capture-error');
    }
  }
  startButton.addEventListener('click',()=>runControl('CAPTURE_START'));
  stopButton.addEventListener('click',()=>runControl('CAPTURE_STOP'));
  scrollStart.addEventListener('click',()=>runControl('SCROLL_START'));
  scrollStop.addEventListener('click',()=>runControl('SCROLL_STOP'));
  document.getElementById('btn-refresh-collection').addEventListener('click', refresh);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.captureSessions) refreshControls();
    if (area === 'local' && (changes.captureIndex || changes.captureError)) refresh();
  });
  window.XFollowCollection = { refresh };
})();
