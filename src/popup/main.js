/**
 * UI Controller for X-Follow Assistant
 * Modernized for "Top-tier Aesthetic"
 */

const DEFAULT_SETTINGS = {
  minInterval: 3,
  maxInterval: 8,
  batchSize: 20,
  restTime: 15,
  onlyBlueTick: false
};

const elements = {
  inputs: {
    minInterval: document.getElementById('setting-min-interval'),
    maxInterval: document.getElementById('setting-max-interval'),
    batchSize: document.getElementById('setting-batch-size'),
    restTime: document.getElementById('setting-rest-time'),
    onlyBlueTick: document.getElementById('setting-blue-tick'),
  },
  stats: {
    followed: document.getElementById('count-followed'),
    skipped: document.getElementById('count-skipped'),
    statusPulse: document.getElementById('status-pulse'),
    statusText: document.getElementById('status-text'),
  },
  btnStart: document.getElementById('btn-start'),
  logContainer: document.getElementById('log-container'),
  btnClearLogs: document.getElementById('btn-clear-logs'),
  // History
  historyList: document.getElementById('history-list'),
  btnClearHistory: document.getElementById('btn-clear-history'),
  tabs: document.querySelectorAll('.tab-btn'),
  views: {
      dashboard: document.getElementById('view-dashboard'),
      history: document.getElementById('view-history')
  }
};

let isRunning = false;

// Icons SVG strings
const ICON_PLAY = `<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
const ICON_STOP = `<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;
const ICON_LINK = `<svg class="icon-link" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  pingContentScript();
  renderHistoryList();
});

async function loadSettings() {
  const result = await chrome.storage.local.get(['settings', 'activityLogs']);
  let settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };

  // Migration: Upgrade old default 5 or 10 to new default 15
  if (settings.restTime === 5 || settings.restTime === 10) {
      settings.restTime = 15;
      chrome.storage.local.set({ settings: { ...settings } });
  }

  elements.inputs.minInterval.value = settings.minInterval;
  elements.inputs.maxInterval.value = settings.maxInterval;
  elements.inputs.batchSize.value = settings.batchSize;
  elements.inputs.restTime.value = settings.restTime;
  elements.inputs.onlyBlueTick.checked = settings.onlyBlueTick;
  
  // Load Mode & Activate Tab
  window.currentMode = settings.mode || 'FOLLOW';
  activateTabByMode(window.currentMode);

  if (result.activityLogs && Array.isArray(result.activityLogs)) {
    result.activityLogs.forEach(log => {
      renderLogEntry(log.time, log.level, log.text);
    });
  }
}

async function saveSettings() {
  const settings = {
    minInterval: parseInt(elements.inputs.minInterval.value, 10),
    maxInterval: parseInt(elements.inputs.maxInterval.value, 10),
    batchSize: parseInt(elements.inputs.batchSize.value, 10),
    restTime: parseInt(elements.inputs.restTime.value, 10),
    onlyBlueTick: elements.inputs.onlyBlueTick.checked,
    mode: window.currentMode || 'FOLLOW'
  };
  await chrome.storage.local.set({ settings });
  return settings;
}

function setupEventListeners() {
  Object.values(elements.inputs).forEach(el => {
    el.addEventListener('change', (e) => {
        // Validation for Batch Size
        if (e.target.id === 'setting-batch-size') {
            let val = parseInt(e.target.value, 10);
            if (val > 15) {
                val = 15;
                e.target.value = 15;
            }
        }
        saveSettings();
    });
  });
  
  elements.btnStart.addEventListener('click', toggleEngine);

  elements.btnClearLogs.addEventListener('click', async () => {
    elements.logContainer.innerHTML = '';
    await chrome.storage.local.set({ activityLogs: [] });
    addLog('System', '日志流已清空');
  });

  // Tab Switching Logic (Refactored for Top-Level Modes)
  elements.tabs.forEach(btn => {
      btn.addEventListener('click', () => {
          const tabName = btn.dataset.tab;
          
          // 1. Update Tab Visuals
          elements.tabs.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          // 2. Handle Logic based on Tab
          if (tabName === 'history') {
              // Hide Dashboard, Show History
              elements.views.dashboard.classList.remove('active');
              elements.views.history.classList.add('active');
              renderHistoryList();
          } else {
              // Show Dashboard
              elements.views.history.classList.remove('active');
              elements.views.dashboard.classList.add('active');
              
              // Switch Mode (Follow vs Unfollow)
              const newMode = (tabName === 'unfollow') ? 'UNFOLLOW' : 'FOLLOW';
              window.currentMode = newMode;
              updateUIForMode(newMode);
              saveSettings(); // Persist the mode change
          }
      });
  });
  
  elements.btnClearHistory.addEventListener('click', async () => {
      if (confirm('确定要永久清空所有历史记录吗？')) {
          await chrome.storage.local.set({ history: [] });
          renderHistoryList();
      }
  });

  // --- Modal Logic ---
  const modal = document.getElementById('modal-donate');
  const btnCoffee = document.getElementById('btn-coffee');
  const btnCloseModal = document.getElementById('btn-close-modal');

  btnCoffee.addEventListener('click', () => {
      modal.classList.add('active');
  });

  btnCloseModal.addEventListener('click', () => {
      modal.classList.remove('active');
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
      if (e.target === modal) {
          modal.classList.remove('active');
      }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'LOG') {
      renderLogEntry(message.payload.time, message.payload.level, message.payload.text);
    } else if (message.type === 'STAT_UPDATE') {
      updateStats(message.payload);
    } else if (message.type === 'STATUS_CHANGE') {
      updateStatus(message.payload.status);
    }
  });
}

// --- History Rendering ---

function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds/60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds/3600)} 小时前`;
    return `${date.getMonth()+1}月${date.getDate()}日`;
}

async function renderHistoryList() {
    const result = await chrome.storage.local.get(['history']);
    const history = result.history || [];
    const container = elements.historyList;

    container.innerHTML = '';

    if (history.length === 0) {
        container.innerHTML = '<div style="padding:60px 0; text-align:center; color:var(--text-secondary); opacity:0.5;">暂无历史记录</div>';
        return;
    }

    history.forEach(session => {
        const item = document.createElement('div');
        item.className = 'history-item';
        
        const timeAgo = formatTimeAgo(session.startTime);
        const title = session.title || session.url;
        const isUnfollow = session.mode === 'UNFOLLOW' || (session.title && session.title.includes('[UNFOLLOW]'));
        
        // Logs
        let logsHtml = '';
        if (session.logs && session.logs.length > 0) {
            logsHtml = session.logs.map(l => 
                `<div class="log-entry ${l.level}">${l.time} - ${l.text}</div>`
            ).join('');
        } else {
            logsHtml = '<div style="color:var(--text-secondary); padding:10px;">无详细日志</div>';
        }

        // Stats Logic
        let statsHtml = '';
        if (isUnfollow) {
            statsHtml = `
                <span class="tag danger">取关 ${session.stats.followed}</span>
                <span class="tag">跳过 ${session.stats.skipped}</span>
            `;
        } else {
            statsHtml = `
                <span class="tag success">关注 ${session.stats.followed}</span>
                <span class="tag">跳过 ${session.stats.skipped}</span>
            `;
        }

        item.innerHTML = `
            <div class="history-summary">
                <div class="h-content">
                    <div class="h-meta">
                        <span>${timeAgo}</span>
                        <span>•</span>
                        <span>${session.startTime.split(' ')[1] || session.startTime}</span>
                    </div>
                    <div class="h-title" title="${session.url}">${title}</div>
                    <div class="h-stats">
                        ${statsHtml}
                    </div>
                </div>
                <div class="h-action">
                    <div class="btn-link" title="在新标签页打开帖子">
                        ${ICON_LINK}
                    </div>
                </div>
            </div>
            <div class="history-details">
                ${logsHtml}
            </div>
        `;

        // Click Logic
        const summary = item.querySelector('.history-summary');
        const linkBtn = item.querySelector('.btn-link');

        // Link Button Click (Stop propagation to prevent toggle)
        linkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.tabs.create({ url: session.url });
        });

        // Row Click (Toggle Details)
        summary.addEventListener('click', () => {
            item.classList.toggle('expanded');
        });

        container.appendChild(item);
    });
}

// --- Engine Control ---

function activateTabByMode(mode) {
    const tabName = (mode === 'UNFOLLOW') ? 'unfollow' : 'follow';
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    
    if (tabBtn) {
        // Deactivate all
        elements.tabs.forEach(b => b.classList.remove('active'));
        elements.views.history.classList.remove('active');
        
        // Activate target
        tabBtn.classList.add('active');
        elements.views.dashboard.classList.add('active');
        
        updateUIForMode(mode);
    }
}

function updateUIForMode(mode) {
    const startBtnText = elements.btnStart.querySelector('.btn-text');
    const followedLabel = document.querySelector('#count-followed').parentElement.querySelector('.stat-desc');
    
    // Reset classes first if any
    elements.btnStart.classList.remove('btn-danger');

    if (mode === 'UNFOLLOW') {
        if (!isRunning) startBtnText.innerText = '启动取关助手';
        followedLabel.innerText = '已取关';
        // Optional: Change button color to indicate destructive action
        // elements.btnStart.style.background = 'var(--danger)'; // User might prefer CSS class
    } else {
        if (!isRunning) startBtnText.innerText = '启动关注引擎';
        followedLabel.innerText = '已关注';
        // elements.btnStart.style.background = 'var(--text-primary)';
    }
}

function setButtonState(state) {
    const currentMode = window.currentMode || 'FOLLOW';
    const actionName = currentMode === 'UNFOLLOW' ? '助手' : '引擎';

    if (state === 'running') {
        elements.btnStart.innerHTML = `${ICON_STOP} <span class="btn-text">停止${actionName}</span>`;
        elements.btnStart.style.background = 'var(--text-primary)'; 
        elements.btnStart.style.color = 'black';
    } else {
        elements.btnStart.innerHTML = `${ICON_PLAY} <span class="btn-text">启动${actionName}</span>`;
        elements.btnStart.style.background = 'var(--text-primary)';
        elements.btnStart.style.color = 'black';
    }
}

async function toggleEngine() {
  const settings = await saveSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) return;

  if (!isRunning) {
    // Start
    try {
        await chrome.tabs.sendMessage(tab.id, { 
            type: 'CMD_START', 
            payload: settings 
        });
        updateStatus('ACTIVE');
        setButtonState('running');
        isRunning = true;
    } catch (err) {
        // Fallback: Auto-inject if connection failed
        addLog('warn', '连接断开，尝试自动修复...');
        try {
            // Inject CSS first
            await chrome.scripting.insertCSS({
                target: { tabId: tab.id },
                files: ['src/content/style.css']
            });
            // Then JS
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['src/content/content.js']
            });
            
            await new Promise(r => setTimeout(r, 500)); // Wait for init
            
            // Retry Start
            await chrome.tabs.sendMessage(tab.id, { 
                type: 'CMD_START', 
                payload: settings 
            });
            
            addLog('success', '连接已恢复');
            updateStatus('ACTIVE');
            setButtonState('running');
            isRunning = true;
        } catch (injectErr) {
            console.error(injectErr);
            addLog('error', '无法启动: 请尝试刷新页面');
        }
    }
  } else {
    // Stop
    chrome.tabs.sendMessage(tab.id, { type: 'CMD_STOP' });
    updateStatus('IDLE');
    setButtonState('idle');
    isRunning = false;
  }
}

function pingContentScript() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'CMD_PING' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response) {
            // Update mode if engine is running (source of truth)
            if (response.mode) {
                window.currentMode = response.mode;
                activateTabByMode(response.mode);
            }
            
            if (response.isRunning) {
                isRunning = true;
                setButtonState('running');
                updateStatus(response.status || 'ACTIVE');
                
                // Sync Stats
                if (response.stats) {
                    updateStats(response.stats);
                }
                
                // Sync Logs
                if (response.logs && Array.isArray(response.logs)) {
                    elements.logContainer.innerHTML = ''; // Clear initial message
                    response.logs.forEach(log => {
                        renderLogEntry(log.time, log.level, log.text);
                    });
                }
            }
        }
      });
    }
  });
}

// --- Helpers ---

const STATUS_MAP = {
  'ACTIVE': '运行中',
  'IDLE': '就绪',
  'RESTING': '休息中',
  'FINISHED': '已完成'
};

function updateStatus(status) {
  let label = STATUS_MAP[status] || status;
  
  // Handle packed status: "RESTING|09:59"
  if (status.startsWith('RESTING|')) {
      const time = status.split('|')[1];
      label = `休息中 (${time})`;
      status = 'RESTING'; // Normalize for CSS
  }

  elements.stats.statusText.innerText = label;
  
  elements.stats.statusPulse.className = 'pulse-dot';
  if (status === 'ACTIVE') {
    elements.stats.statusPulse.classList.add('active');
    elements.stats.statusText.style.color = 'var(--accent-primary)';
  } else if (status === 'RESTING') {
    elements.stats.statusPulse.classList.add('resting');
    elements.stats.statusText.style.color = 'var(--danger)';
  } else if (status === 'FINISHED') {
    elements.stats.statusPulse.classList.add('active');
    elements.stats.statusPulse.style.backgroundColor = 'var(--success)';
    elements.stats.statusText.style.color = 'var(--success)';
  } else {
      elements.stats.statusText.style.color = 'var(--text-primary)';
  }
}

function updateStats(payload) {
  if (payload.followed !== undefined) elements.stats.followed.innerText = payload.followed;
  if (payload.skipped !== undefined) elements.stats.skipped.innerText = payload.skipped;
}

function addLog(level, text) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
  renderLogEntry(time, level, text);
}

function renderLogEntry(time, level, text) {
  const div = document.createElement('div');
  div.className = `log-entry ${level.toLowerCase()}`;
  
  // Highlight keywords
  let styledText = text;
  if (text.includes('@')) {
      styledText = text.replace(/(@\w+)/g, '<span style="color:var(--accent-primary)">$1</span>');
  }

  div.innerHTML = `<span style="opacity:0.5; margin-right:6px;">${time}</span> ${styledText}`;
  
  elements.logContainer.appendChild(div);
  elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
}