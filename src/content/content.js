
/**
 * X-Follow Assistant - Content Script
 * High-performance, heuristic-based automation engine.
 */

(() => {
    // Prevent multiple injections
    if (window.XFollowEngine) return;
  
    /* ==========================================================================
       Classes
       ========================================================================== */
  
    class Logger {
      static async log(level, text) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = { time: timestamp, level, text };
        
        // 1. Console Log (DevTools)
        const style = level === 'error' ? 'color: red; font-weight: bold' : 
                      level === 'success' ? 'color: green' : 'color: blue';
        console.log(`%c[X-Follow] ${text}`, style);

        // 2. Runtime Message (Popup UI)
        try {
          chrome.runtime.sendMessage({
            type: 'LOG',
            payload: logEntry
          });
        } catch (e) {
          // Extension popup is likely closed
        }

        // 3. Delegate to Engine for Session Recording
        if (window.XFollowEngine && window.XFollowEngine.isRunning) {
            window.XFollowEngine.recordLog(logEntry);
        }
      }
  
      static updateStats(followed, skipped) {
        try {
          chrome.runtime.sendMessage({
            type: 'STAT_UPDATE',
            payload: { followed, skipped }
          });
        } catch (e) {}
      }
  
      static updateStatus(status) {
        try {
          chrome.runtime.sendMessage({
            type: 'STATUS_CHANGE',
            payload: { status }
          });
        } catch (e) {}
      }
    }
  
    class Humanizer {
      static async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }
  
      static async randomDelay(minSec, maxSec) {
        const min = minSec * 1000;
        const max = maxSec * 1000;
        const delay = Math.floor(Math.random() * (max - min + 1) + min);
        return this.sleep(delay);
      }
  
      static async tinyPause() {
        return this.sleep(Math.floor(Math.random() * 300 + 200));
      }
    }

    class Visualizer {
        static markProcessed(element, status) {
            element.style.transition = "all 0.3s ease";
            if (status === 'SUCCESS') {
                element.style.borderLeft = "4px solid #00ba7c"; 
                element.style.backgroundColor = "rgba(0, 186, 124, 0.05)";
            } else if (status === 'SKIPPED') {
                element.style.borderLeft = "4px solid #536471"; 
                element.style.opacity = "0.7";
            } else if (status === 'UNFOLLOWED') {
                element.style.borderLeft = "4px solid #f91880";
                element.style.backgroundColor = "rgba(249, 24, 128, 0.05)";
            }
        }

        static injectBadge(element) {
            // Find avatar container
            const avatarContainer = element.querySelector('[data-testid^="UserAvatar-Container-"]') || element;
            if (!avatarContainer.querySelector('.xf-badge-bye')) {
                const badge = document.createElement('div');
                badge.className = 'xf-badge-bye';
                badge.innerText = 'Bye';
                
                // Ensure relative positioning on parent for absolute badge
                const parentStyle = window.getComputedStyle(avatarContainer);
                if (parentStyle.position === 'static') {
                    avatarContainer.style.position = 'relative';
                }
                
                avatarContainer.appendChild(badge);
            }
        }
    }
  
    class DOMScanner {
      static getScrollContainer() { return window; }
  
      static findTargets() {
        const targets = [];
        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        tweets.forEach(el => targets.push({ type: 'tweet', element: el }));
        const userCells = document.querySelectorAll('[data-testid="UserCell"]');
        userCells.forEach(el => targets.push({ type: 'cell', element: el }));
        return targets;
      }
  
      static analyzeTarget(targetObj) {
        const { type, element } = targetObj;
        let handle = 'Unknown';
        let isVerified = false;
        let actionElement = null;

        if (type === 'tweet') {
            const nameContainer = element.querySelector('[data-testid="User-Name"]');
            if (nameContainer) {
                const link = nameContainer.querySelector('a[href^="/"]');
                if (link) handle = link.getAttribute('href'); 
                isVerified = !!nameContainer.querySelector('[data-testid="icon-verified"]');
                actionElement = link; 
            }
        } else if (type === 'cell') {
            const userLink = element.querySelector('a[href^="/"]');
            if (userLink) handle = userLink.getAttribute('href');
            isVerified = !!element.querySelector('[data-testid="icon-verified"]');
            actionElement = element;
        }

        if (handle === 'Unknown' || !actionElement) return null;
        handle = handle.replace('/', '@');

        // Extra check for Follows You indicator (for Unfollow Mode)
        const followsYou = !!element.querySelector('[data-testid="userFollowIndicator"]');

        return { type, element, handle, isVerified, actionElement, followsYou };
      }
  
      static async scrollToBottom() {
        window.scrollBy({ top: 800, behavior: 'smooth' });
      }
    }

    class RateLimitDetector {
        static check() {
            // X usually shows a toast with data-testid="toast"
            const toast = document.querySelector('[data-testid="toast"]');
            if (toast) {
                const text = toast.innerText.toLowerCase();
                if (text.includes('limit') || text.includes('限制') || text.includes('wait') || text.includes('稍等')) {
                    return true;
                }
            }
            // Check for generic alerts if toast misses
            return false;
        }
    }

    class HoverCardController {
        static async processHoverAction(targetElement) {
            const mouseOverEvent = new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true });
            targetElement.dispatchEvent(mouseOverEvent);

            let hoverCard = null;
            let attempts = 0;
            while (attempts < 20) {
                await Humanizer.sleep(100);
                hoverCard = document.querySelector('[data-testid="HoverCard"]');
                if (hoverCard) break;
                attempts++;
            }

            if (!hoverCard) {
                const mouseOutEvent = new MouseEvent('mouseout', { view: window, bubbles: true, cancelable: true });
                targetElement.dispatchEvent(mouseOutEvent);
                return { status: 'ERROR', msg: '悬停卡片未出现' };
            }

            let followBtn = hoverCard.querySelector('[data-testid$="-follow"]');
            let unfollowBtn = hoverCard.querySelector('[data-testid$="-unfollow"]');
            let result = { status: 'UNKNOWN', msg: '' };

            if (unfollowBtn) {
                result = { status: 'SKIPPED', msg: '已关注' };
            } else if (followBtn) {
                const label = followBtn.getAttribute('aria-label') || followBtn.innerText || "";
                if (label.toLowerCase().includes('following') || label.toLowerCase().includes('关注中')) {
                     result = { status: 'SKIPPED', msg: '已关注' };
                } else {
                    // --- Click & Validate ---
                    followBtn.click();
                    await Humanizer.sleep(1000); // Wait for X response

                    if (RateLimitDetector.check()) {
                        result = { status: 'RATE_LIMIT', msg: '触发官方限流' };
                    } else {
                        // Re-check button state
                        let newUnfollowBtn = hoverCard.querySelector('[data-testid$="-unfollow"]');
                        let newFollowBtn = hoverCard.querySelector('[data-testid$="-follow"]');
                        
                        // Sometimes button stays as 'follow' but style changes to 'following', or it becomes 'unfollow'
                        // Safe check: if we see 'unfollow' button OR the follow button now says 'Following'
                        let isSuccess = !!newUnfollowBtn;
                        if (!isSuccess && newFollowBtn) {
                             const newLabel = newFollowBtn.getAttribute('aria-label') || newFollowBtn.innerText || "";
                             if (newLabel.toLowerCase().includes('following') || newLabel.toLowerCase().includes('关注中')) {
                                 isSuccess = true;
                             }
                        }

                        if (isSuccess) {
                            result = { status: 'SUCCESS', msg: '通过悬停关注成功' };
                        } else {
                            result = { status: 'ERROR', msg: '点击无效 (可能是隐性限流)' };
                        }
                    }
                }
            } else {
                result = { status: 'SKIPPED', msg: '未找到关注按钮' };
            }

            const mouseOutEvent = new MouseEvent('mouseout', { view: window, bubbles: true, cancelable: true });
            targetElement.dispatchEvent(mouseOutEvent);
            document.body.dispatchEvent(new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true }));
            await Humanizer.sleep(500);

            return result;
        }
    }

    class UnfollowController {
        static async processUnfollow(element) {
            const unfollowBtn = element.querySelector('[data-testid$="-unfollow"]');
            
            if (!unfollowBtn) {
                // Double check if it's already 'follow' button
                const followBtn = element.querySelector('[data-testid$="-follow"]');
                if (followBtn) return { status: 'SKIPPED', msg: '未关注此人' };
                return { status: 'ERROR', msg: '未找到操作按钮' };
            }

            unfollowBtn.click();
            await Humanizer.sleep(500);

            // Handle Confirmation Dialog
            const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
            if (confirmBtn) {
                confirmBtn.click();
                await Humanizer.sleep(1000);
            }
            
            if (RateLimitDetector.check()) {
                return { status: 'RATE_LIMIT', msg: '触发官方限流' };
            }

            return { status: 'SUCCESS', msg: '取关成功' };
        }
    }
  
    class Engine {
      constructor() {
        this.isRunning = false;
        this.config = {};
        this.stats = { followed: 0, skipped: 0 };
        this.processedSet = new Set();
        this.currentSession = null;
        this.mode = 'FOLLOW'; // 'FOLLOW' or 'UNFOLLOW'
      }

      isValidPage() {
          if (this.mode === 'UNFOLLOW') {
              // Unfollow mode strictly for /following list
              return window.location.pathname.includes('/following');
          }
          // Follow mode works on Status and List pages
          return /^https?:\/\/(?:twitter|x)\.com\/\w+\/status\/\d+/.test(window.location.href);
      }
  
      start(config) {
        if (this.isRunning) return;
        
        this.mode = config.mode || 'FOLLOW';

        if (!this.isValidPage()) {
            const msg = this.mode === 'UNFOLLOW' 
                ? '页面无效：请打开您的“正在关注”列表 (/following) 页面。'
                : '页面无效：请打开具体的帖子/推文详情页。';
            Logger.log('error', msg);
            alert(`X-Follow 提示：${msg}`);
            return;
        }

        this.config = config;
        this.isRunning = true;
        this.stats = { followed: 0, skipped: 0 };
        this.processedSet.clear();

        // Initialize Session
        this.currentSession = {
            id: Date.now().toString(),
            startTime: new Date().toLocaleString(),
            url: window.location.href,
            title: `[${this.mode}] ` + document.title.replace(' on X:', '').trim(),
            logs: [],
            stats: { followed: 0, skipped: 0 }
        };
        
        Logger.log('info', `引擎已启动 [${this.mode}]。每批次: ${config.batchSize}`);
        Logger.updateStatus('ACTIVE');
        
        this.loop();
      }

      recordLog(logEntry) {
          if (this.currentSession && this.currentSession.logs) {
              if (this.currentSession.logs.length < 200) {
                  this.currentSession.logs.push(logEntry);
              }
          }
      }

      async saveSession() {
          if (!this.currentSession) return;
          
          this.currentSession.endTime = new Date().toLocaleString();
          this.currentSession.stats = { ...this.stats };
          this.currentSession.mode = this.mode;

          try {
              const result = await chrome.storage.local.get(['history']);
              let history = result.history || [];
              history.unshift(this.currentSession);
              if (history.length > 20) history = history.slice(0, 20);
              await chrome.storage.local.set({ history });
              Logger.log('system', '会话记录已保存至历史。');
          } catch (e) {
              console.error('Failed to save session:', e);
          }

          this.currentSession = null;
      }
  
      async stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        Logger.log('warn', '引擎已停止。');
        Logger.updateStatus('IDLE');
        await this.saveSession();
      }

      async finish() {
        this.isRunning = false;
        Logger.log('success', '任务完成：没有发现更多目标。');
        Logger.updateStatus('FINISHED');
        await this.saveSession();
        alert('X-Follow: 任务已完成。');
      }
  
      async loop() {
        let batchCount = 0;
        let emptyScanCount = 0; 
        const MAX_EMPTY_SCANS = 5;
  
        try {
            while (this.isRunning) {
            const targets = DOMScanner.findTargets();
            let processedInThisPass = 0;
    
            for (const targetEl of targets) {
                if (!this.isRunning) break;
                
                const info = DOMScanner.analyzeTarget(targetEl);
                if (!info) continue;

                const uniqueId = info.handle;
    
                if (this.processedSet.has(uniqueId)) continue;
                
                // === MODE: UNFOLLOW ===
                if (this.mode === 'UNFOLLOW') {
                    // Only process Cells (User Lists)
                    if (info.type !== 'cell') continue;

                    // Logic: If they follow you, SKIP. If they DON'T follow you, UNFOLLOW.
                    if (info.followsYou) {
                        // They follow me back -> Keep them
                        this.stats.skipped++;
                        this.processedSet.add(uniqueId);
                        // Visualizer.markProcessed(info.element, 'SKIPPED'); // Optional: Don't mark safe users to keep UI clean? Or mark them green?
                        continue;
                    } else {
                        // They DO NOT follow back -> Target acquired
                        
                        // Check Blue Tick Gate
                        if (this.config.onlyBlueTick && info.isVerified) {
                             // If settings say "Only Blue Tick" (usually means only follow blue tick), 
                             // for Unfollow, maybe reuse it as "Protect Blue Ticks"? 
                             // Let's assume for Unfollow mode, we might want to Ignore Blue Ticks (don't unfollow them)?
                             // Or stick to simple logic: config.onlyBlueTick usually implies targeting.
                             // Let's IGNORE this setting for Unfollow for now to be safe, or treat it as "Unfollow only Verified"?
                             // Better interpretation: "Only process verified users".
                             // But standard use case is "Unfollow everyone who doesn't follow back".
                             // Let's skip the Blue Tick check for Unfollow mode unless specifically requested.
                        }

                        // Scroll & Pause
                        info.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        await Humanizer.tinyPause();
                        if (!this.isRunning) break;
                        
                        // Inject "Bye" Badge
                        Visualizer.injectBadge(info.element);
                        
                        // Execute Unfollow
                        Logger.log('info', `检测到单向关注: ${info.handle}, 准备取关...`);
                        const actionResult = await UnfollowController.processUnfollow(info.element);

                        if (actionResult.status === 'SUCCESS') {
                            this.stats.followed++; // Reuse 'followed' counter as 'actioned'
                            batchCount++;
                            Visualizer.markProcessed(info.element, 'UNFOLLOWED');
                            Logger.log('warn', `已取关 ${info.handle}`);
                            
                            // Random Delay
                            await Humanizer.randomDelay(this.config.minInterval, this.config.maxInterval);
                        } else if (actionResult.status === 'RATE_LIMIT') {
                            Logger.log('error', `❌ 触发官方限流！进入强制休息模式...`);
                            Logger.updateStatus('RESTING');
                            
                            // Force rest for configured time (default 10 mins)
                            // We use a fixed 10m or config.restTime, whichever is safer? 
                            // Let's use config.restTime but ensure at least 10m if it's too low?
                            // User request: "Default rest 10 min". Let's use config.restTime.
                            // If user set 1 min, it might not be enough. Let's enforce max(config.restTime, 10).
                            const restMins = Math.max(this.config.restTime, 10);
                            
                            Logger.log('warn', `将在 ${restMins} 分钟后尝试恢复...`);
                            await Humanizer.sleep(restMins * 60 * 1000);
                            
                            Logger.log('info', '限流休息结束，尝试继续...');
                            Logger.updateStatus('ACTIVE');
                            batchCount = 0; // Reset batch count
                            // Don't increment processedInThisPass or add to set, so we retry? 
                            // Actually, if we failed this one, we should probably skip it or retry it next loop.
                            // Let's just continue loop. The current target 'uniqueId' was NOT added to processedSet yet?
                            // Wait, logic below adds it. We should probably NOT add it if we want to retry it later,
                            // OR add it to skip it. Safest is to skip this specific user and move on.
                            this.processedSet.add(uniqueId); 
                        } else {
                             Logger.log('error', `取关失败 ${info.handle}: ${actionResult.msg}`);
                             this.processedSet.add(uniqueId);
                        }

                        // this.processedSet.add(uniqueId); // Moved inside to handle flow
                        Logger.updateStats(this.stats.followed, this.stats.skipped);
                        processedInThisPass++;
                    }
                        Logger.updateStats(this.stats.followed, this.stats.skipped);
                        processedInThisPass++;
                    }
                }
                
                // === MODE: FOLLOW (Original) ===
                else {
                    let status = 'UNKNOWN';
                    if (info.type === 'cell') {
                        const unfollowBtn = info.element.querySelector('[data-testid$="-unfollow"]');
                        if (unfollowBtn) status = 'FOLLOWING';
                    }
        
                    // Gate 1: Blue Tick
                    if (this.config.onlyBlueTick && !info.isVerified) {
                        this.stats.skipped++;
                        this.processedSet.add(uniqueId);
                        Logger.updateStats(this.stats.followed, this.stats.skipped);
                        Visualizer.markProcessed(info.element, 'SKIPPED'); 
                        continue;
                    }

                    // Gate 2: Already Followed
                    if (status === 'FOLLOWING') {
                        this.stats.skipped++;
                        this.processedSet.add(uniqueId);
                        Visualizer.markProcessed(info.element, 'SKIPPED');
                        continue;
                    }
        
                    // Gate 3: Action Execution
                    info.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    await Humanizer.tinyPause();
                    if (!this.isRunning) break;

                    let actionResult = { status: 'SKIPPED', msg: '' };

                    if (info.type === 'tweet') {
                        Logger.log('info', `正在检查 ${info.handle}...`);
                        actionResult = await HoverCardController.processHoverAction(info.actionElement);
                    } else if (info.type === 'cell') {
                        const followBtn = info.element.querySelector('[data-testid$="-follow"]');
                        if (followBtn) {
                            followBtn.click();
                            await Humanizer.sleep(1000); 
                            
                            if (RateLimitDetector.check()) {
                                actionResult = { status: 'RATE_LIMIT', msg: '触发官方限流' };
                            } else {
                                // Validate direct follow
                                const newUnfollowBtn = info.element.querySelector('[data-testid$="-unfollow"]');
                                if (newUnfollowBtn) {
                                    actionResult = { status: 'SUCCESS', msg: '关注成功' };
                                } else {
                                    // Sometimes X UI lags, but if no error toast, we might assume success or retry?
                                    // Let's be strict: if button didn't change, it failed.
                                    actionResult = { status: 'ERROR', msg: '关注失败 (点击无效)' };
                                }
                            }
                        } else {
                            actionResult = { status: 'SKIPPED', msg: '已关注' };
                        }
                    }

                    if (actionResult.status === 'SUCCESS') {
                        this.stats.followed++;
                        batchCount++;
                        Visualizer.markProcessed(info.element, 'SUCCESS');
                        Logger.log('success', `已关注 ${info.handle}`);
                        await Humanizer.randomDelay(this.config.minInterval, this.config.maxInterval);
                    } else if (actionResult.status === 'RATE_LIMIT') {
                         Logger.log('error', `❌ 触发官方限流！进入强制休息模式...`);
                         Logger.updateStatus('RESTING');
                         
                         const restMins = Math.max(this.config.restTime, 10);
                         Logger.log('warn', `将在 ${restMins} 分钟后尝试恢复...`);
                         await Humanizer.sleep(restMins * 60 * 1000);
                         
                         Logger.log('info', '限流休息结束，尝试继续...');
                         Logger.updateStatus('ACTIVE');
                         batchCount = 0;
                    } else if (actionResult.status === 'SKIPPED') {
                        this.stats.skipped++;
                        Visualizer.markProcessed(info.element, 'SKIPPED');
                    } else if (actionResult.status === 'ERROR') {
                        Logger.log('warn', `错误 ${info.handle}: ${actionResult.msg}`);
                    }

                    this.processedSet.add(uniqueId);
                    Logger.updateStats(this.stats.followed, this.stats.skipped);
                    processedInThisPass++;
                    
                    if (actionResult.status === 'SUCCESS') {
                        await Humanizer.randomDelay(this.config.minInterval, this.config.maxInterval);
                    }
                }

                // === Batch Handling (Shared) ===
                if (batchCount >= this.config.batchSize) {
                    Logger.log('warn', `达到批次限制 (${batchCount})。休息 ${this.config.restTime} 分钟...`);
                    Logger.updateStatus('RESTING');
                    await Humanizer.sleep(this.config.restTime * 60 * 1000);
                    Logger.log('info', '休息结束，继续运行...');
                    Logger.updateStatus('ACTIVE');
                    batchCount = 0;
                }
            }
    
            if (!this.isRunning) break;
    
            if (processedInThisPass === 0) {
                emptyScanCount++;
                if (emptyScanCount >= MAX_EMPTY_SCANS) {
                    await this.finish();
                    break;
                }
                Logger.log('info', `未发现新目标，尝试向下滚动... (${emptyScanCount}/${MAX_EMPTY_SCANS})`);
                DOMScanner.scrollToBottom();
                await Humanizer.sleep(3000); 
            } else {
                emptyScanCount = 0; 
                await Humanizer.sleep(1000);
            }
            }
        } catch (err) {
            Logger.log('error', `严重错误: ${err.message}`);
            this.stop();
        }
      }
    }
  
    const engine = new Engine();
    window.XFollowEngine = engine; 
  
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'CMD_START') {
        engine.start(message.payload);
      } else if (message.type === 'CMD_STOP') {
        engine.stop();
      } else if (message.type === 'CMD_PING') {
        sendResponse({ 
            isRunning: engine.isRunning, 
            status: engine.isRunning ? 'ACTIVE' : 'IDLE',
            mode: engine.mode 
        });
      }
    });
  
    Logger.log('system', '引擎 V3 (双模版) 已就绪。');
  
  })();
