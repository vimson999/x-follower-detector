/* Uses textContent for API-provided user names; no remote HTML is rendered. */
(() => {
  'use strict';
  const labels = { posts: '帖子', replies: '回复' };
  const list = document.getElementById('collection-list');
  const feedback = document.getElementById('capture-feedback');
  const startButton = document.getElementById('btn-capture-start');
  const stopButton = document.getElementById('btn-capture-stop');
  const target = document.getElementById('capture-target');
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
    startButton.disabled = true;stopButton.disabled = true;
    try {
      const state = await current();
      if (controlBusy) return;
      if (!state.profile) {target.textContent='请打开用户主页的帖子或回复 Tab';return;}
      const active = !!state.result.session;
      target.textContent = `${active ? '采集中' : '已停止'}：@${state.profile.handle} · ${labels[state.profile.tab]}`;
      startButton.disabled = active;stopButton.disabled = !active;
    } catch {target.textContent='请打开 X 用户主页，并刷新页面后使用采集控制。';}
  }
  async function runControl(type) {
    if (controlBusy) return;
    controlBusy = true;startButton.disabled = true;stopButton.disabled = true;
    try {
      const state = await current();
      const result = await chrome.tabs.sendMessage(state.tab.id,{type});
      if (!result?.ok) throw Error(result?.error || '操作失败');
      feedback.classList.remove('capture-error');
      feedback.textContent = type === 'CAPTURE_START' ? '已开始。请向下滚动触发新请求；开始前已加载的内容不会补采。' : '已停止采集，已保存的数据仍可导出。';
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
      feedback.textContent = data.captureError ? `最近保存失败（${date(data.captureError.time)}）：${data.captureError.message}。请刷新页面重新加载相关内容。` : '';
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
  document.getElementById('btn-refresh-collection').addEventListener('click', refresh);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.captureSessions) refreshControls();
    if (area === 'local' && (changes.captureIndex || changes.captureError)) refresh();
  });
  window.XFollowCollection = { refresh };
})();
