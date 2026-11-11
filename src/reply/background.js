/* Reserve a target before the publish click. Never retry an uncertain submission. */
(() => {
  let queue=Promise.resolve();
  const DEFAULT_GEMINI_KEY = '';
  
  const GEMINI_SYSTEM_INSTRUCTION_HOST = `你是推特/X博主 @vimson999（有鱼丨回敬三杯版 🦉✨）。
当前任务：在你自己发布的推文下方，回复前来互动或留言的推友。

【核心人设：平视随和、超短口语、大留白、彻底去AI味】
你是一个真实的都市年轻打工人，平时松弛、嘴贫、平视随和。
你不是文案策划，不是段子手，更不是语言模型。你就像在自家摊位前跟熟人随口唠两句。

【五大铁律】
1. 超短句（4–8个字最佳，绝不超过10个字）：不用任何铺垫，不要因果关系，真人手机单手打字极懒。
2. 绝对严禁关键词死梗：严禁一看到互动就塞人“水瓢”或“鸡蛋”，绝对禁止使用“混个脸熟”、“大活人”等营销号烂梗，绝不当词汇触发机器人！
3. 严禁网络烂梗与客套：严禁“瞳孔地震”、“属于是”、“绝绝子”、“常来常往”、“欢迎常来”等片儿汤话。
4. 纯口语白话：末尾绝对不打任何标点，行内可用空格自然停顿。
5. 严禁照抄示例原话：标杆示例仅供理解口吻，每次回复必须结合对方具体推文细节即兴发挥！

【黄金标杆示例】
对方：来串门了 -> 前排占个座 / 搬个小板凳坐等
对方：眼睛都快看花了 -> 找马斯克报销眼药水 / 俩眼各看各的
对方：最近不是很热闹 -> 分你几个 我这儿批发呢
对方：起这么早吗 -> 被窝生刺 躺不住
对方：还有三小时下班，鱼已经摸上了 -> 提前进入状态
对方：关键没看到鱼 -> 都摸到了 还能让你看
对方：各家AI谁赢，最适合激发灵感 -> 看缘分吧 / 这就开始偷换概念了`;

  const GEMINI_SYSTEM_INSTRUCTION_VISIT = `你是推特/X上的真实活跃推友 @vimson999（有鱼 🦉✨）。
当前任务：在推特时间线刷到推友发推求互动/交友/日常，去留下一句完全像真人随手留的日常短评。

【学真实推特评论区说话——彻底消灭AI机器人味】
真实推友在评论区是怎么互动的：
1. 随性路过打卡：对方求交友/营业，随口回“这就把摊支起来了”、“刚好刷到了”、“算法立功了”、“随手占个座”、“前排路过”。
2. 唠两句日常生活：对方发营业或日常，随口问“还没下班吧”、“摸鱼刚好刷到你”、“下午好 摸鱼呢”、“今天下工挺早”。
3. 生活化直接反应：对方提神喝咖啡“小心超频”，对方摸鱼险被抓“快按Alt Tab”，对方周五等下班“倒计时中”，对方早安冲啊“好 我再躺5分钟”。

【严格禁止四大AI机械病】
1. 绝对严禁重复高频词与套路：绝对禁止使用“混个脸熟”、“大活人”等营销刷量高频词！违者视为机器人违规！
2. 绝对严禁照抄示例原句：标杆示例仅供理解说话语气和极简字数，严禁一字不差输出示例原话，必须结合对方推文的独特字词或细节即兴发挥！
3. 绝对严禁关键词条件反射：严禁一看到“浇水”就机械回复“水瓢”，一看到“串门”就回“领鸡蛋”！
4. 绝对严禁老干部套话与假客套：严禁“加油一起冲”、“互关必回”、“祝开心美好”。

【黄金标杆示例（4–8字最佳，末尾绝无标点，结合对方推文具体细节即兴发挥）】
- 对方求互动交友：营业啦，活人来交朋友 -> 这就把摊支起来了 / 刚好刷到了 / 算法立功了 / 冒个泡证明健在
- 对方打鸡血冲啊：大家早安！今天又是充满希望的一天，兄弟们冲啊！ -> 好 我再躺5分钟 / 大清早哪来这么大劲
- 对方工位摸鱼：下午好困，老板刚刚走过去，差点被抓包 -> 快按Alt Tab / 稳住 假装看屏
- 对方周五等下班：周五了，下午三点的心情谁懂啊 -> 倒计时中 / 心已经溜了
- 对方喝咖啡心慌：今天第二杯冰美式，感觉心脏已经在蹦迪了 -> 小心超频 / 悠着点喝
- 对方抱怨天冷不想起：大冷天早起搬砖太痛苦了 -> 被窝封印了
- 对方晒大餐火锅：今天吃了一顿超级好吃的牛肉火锅 -> 毛肚别烫老了
- 对方吐槽大A亏钱：今天账户绿得心碎 -> 关软件 别看
- 对方赖床生物钟：周六五点醒纯属生物钟作祟 -> 继续跟枕头较劲`;

  async function callGeminiApi({mode='visit', mainPostText='', commentText='', commentAuthor='', commentAuthorName=''}) {
    const fetchFn = typeof fetch === 'function' ? fetch : (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
    if(typeof fetchFn !== 'function') throw Error('当前环境不支持 fetch');
    let apiKey = DEFAULT_GEMINI_KEY;
    try {
      const stored = await chrome.storage.local.get('geminiApiKey');
      if(stored?.geminiApiKey) apiKey = stored.geminiApiKey.trim();
    } catch {}
    if(!apiKey) throw Error('未检测到 Gemini API Key，请先在插件弹窗中填入 API Key');

    let recentList = [];
    try {
      const storedHistory = await chrome.storage.local.get('geminiRecentReplies');
      if(Array.isArray(storedHistory?.geminiRecentReplies)) recentList = storedHistory.geminiRecentReplies;
    } catch {}

    const isHost = mode === 'host';
    const systemInstruction = isHost ? GEMINI_SYSTEM_INSTRUCTION_HOST : GEMINI_SYSTEM_INSTRUCTION_VISIT;
    const authorDisplayName = `@${commentAuthor || '推友'}`;

    const avoidSection = recentList.length > 0
      ? `\n\n【最近已发布的回复历史（必须严格避开！绝对严禁重复相似词汇或句式，必须换全新的角度与表达）】：\n${recentList.slice(-12).map(r => `"${r}"`).join(', ')}`
      : '';

    const prompt = (isHost
      ? `【我发布的主帖正文】\n${mainPostText || '日常发帖出摊'}\n\n【对方推友】\n${authorDisplayName}\n\n【对方评论内容】\n${commentText}\n\n请直接输出一句极其自然、真人口吻的短评（4-8字，末尾无标点）：`
      : `【对方发布的推文内容】\n${commentText}\n\n请直接输出一句像评论区真人一样随口搭讪的短评（4-8字，末尾无标点）：`
    ) + avoidSection;

    console.log(`[x-helper Gemini] 准备调用 API [${mode}]，入参:`, { mode, mainPostText, commentAuthor, commentAuthorName, commentText });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;
    const payload = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.95, maxOutputTokens: 25 }
    };

    let text = '', errorMsg = null;
    const maxAttempts = 3;
    for(let attempt=1; attempt<=maxAttempts; attempt++) {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(()=>controller.abort(), 15000) : null;
        const res = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller?.signal
        });
        if(timer) clearTimeout(timer);
        if(!res.ok) {
          const errText = await res.text().catch(()=>'');
          throw Error(`Gemini API 错误 (${res.status}): ${errText.slice(0, 150)}`);
        }
        const data = await res.json();
        text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        text = text.replace(/^["'“”‘`]+|["'“”‘`]+$/g, '')
                   .replace(/^[#\-*\s]+/, '')
                   .replace(/[。！!]+$/g, '')
                   .trim();
        if(!text) throw Error('Gemini API 未返回有效回复');

        // Check if text is repetitive spam or matches recent history
        const isSpammy = /^(?:大?活人来)?混个脸熟$/i.test(text);
        if(isSpammy || recentList.includes(text)) {
          console.warn(`[x-helper Gemini] 命中高频词或最近历史重复 ("${text}")，尝试重新生成 (第 ${attempt} 次)...`);
          throw Error(`回复内容重复 ("${text}")，重新生成`);
        }

        console.log(`[x-helper Gemini] [${mode}] 生成成功:`, text);
        errorMsg = null;
        break;
      } catch(err) {
        let msg = err.message || String(err);
        if(err.name === 'AbortError' || msg.includes('aborted')) msg = '请求超时（超过15秒未响应）';
        if(msg.includes('Failed to fetch')) msg = 'Failed to fetch（网络连接中断或被墙，请检查代理节点）';
        errorMsg = msg;
        console.warn(`[x-helper Gemini] [${mode}] 尝试 ${attempt}/${maxAttempts} 失败:`, errorMsg);
        if(attempt < maxAttempts) await new Promise(r=>setTimeout(r, attempt * 1000));
      }
    }

    if(text && !errorMsg) {
      recentList.push(text);
      if(recentList.length > 20) recentList = recentList.slice(-20);
      try {
        await chrome.storage.local.set({
          geminiRecentReplies: recentList,
          lastGeminiLog: {
            time: new Date().toISOString(),
            mode,
            mainPostText,
            commentAuthor,
            commentText,
            prompt,
            reply: text,
            error: null,
            status: 'success'
          }
        });
      } catch {}
    } else {
      try {
        await chrome.storage.local.set({
          lastGeminiLog: {
            time: new Date().toISOString(),
            mode,
            mainPostText,
            commentAuthor,
            commentText,
            prompt,
            reply: null,
            error: errorMsg,
            status: 'failed'
          }
        });
      } catch {}
    }

    if(errorMsg || !text) {
      throw Error(errorMsg || 'Gemini API 生成失败');
    }
    return text;
  }

  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(m?.type === 'GEMINI_GENERATE_REPLY') {
      callGeminiApi(m).then(
        text => reply({ok:true, reply:text}),
        err => reply({ok:false, error:err.message})
      );
      return true;
    }
    if(!['REPLY_TEST_CLAIM','REPLY_TEST_CONFIRMED'].includes(m?.type)) return;
    if(sender.id!==chrome.runtime.id || !sender.tab || !/^https:\/\/(?:x|twitter)\.com\//.test(sender.url || '') || !/^\d+$/.test(m.postId || '')) {
      reply({ok:false,error:'无效的回复任务来源'});return;
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
      if(claims[m.postId]) return {ok:false,error:'此帖子已提交过回复，不会重复发布；请先到 X 检查结果'};
      claims[m.postId]={runId:m.runId,time:new Date().toISOString(),tabId:sender.tab.id};
      await chrome.storage.local.set({replyTestClaims:claims});
      return {ok:true};
    });
    queue.then(reply,error=>reply({ok:false,error:error.message}));return true;
  });
})();
