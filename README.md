# X-Follow Assistant Pro (Chrome Extension)

## 1. 项目简介 | Introduction
**X-Follow Assistant Pro** 是一款基于 Chrome Manifest V3 标准开发的自动化关注工具，专为 Twitter (X.com) 深度运营设计。

它专注于在**帖子详情页 (Post/Status Page)** 自动扫描评论区用户，通过模拟真实人类的交互行为（悬停、等待卡片、点击）来执行关注操作。项目采用了 **Google 级工程标准**，包含完备的防封控启发式算法 (Heuristics)、双层日志系统以及鲁棒的错误边界处理。

---

## 2. 核心功能 | Core Features

### 🛡️ 防封控机制 (Anti-Ban System)
- **拟人化抖动 (Humanizer Jitter)**: 关注间隔不再是固定值，而是在用户设定的区间（如 3-8秒）内遵循随机分布。
- **批次休息 (Batch & Rest)**: 支持设定“每关注 X 人，强制休息 Y 分钟”，打破机器人的连续操作特征。
- **微交互模拟**: 在点击前会有随机的微小停顿 (200-500ms)，模拟人类反应时间。

### 🧠 智能引擎 (Engine V2)
- **双模式扫描 (Hybrid Scanning)**:
  - **Direct Mode**: 针对点赞/转发列表（直接存在按钮）的场景。
  - **Hover Mode (新增)**: 针对评论区回复，自动执行 **"悬停 -> 等待资料卡 -> 扫描卡片 -> 点击关注"** 的复杂交互链条。
- **URL 守卫**: 自动检测当前页面是否为帖子详情页 (`/status/`)，防止在错误的页面运行。
- **蓝标过滤**: 可选仅关注认证用户 (Verified/Blue Tick)。

### 📊 监控与日志
- **UI 仪表盘**: "暗夜极光" (Dark Aurora) 风格界面，实时显示统计数据。
- **持久化日志**: 最近 50 条操作日志自动保存到 `chrome.storage`，重启浏览器不丢失。
- **全局错误捕获**: 核心循环包裹 `try-catch` 边界，防止因页面结构变更导致脚本崩溃。

---

## 3. 技术架构 | Technical Architecture

项目采用原生 ES Modules (无构建工具依赖) 以确保极简与高性能。

```text
/
├── manifest.json            # V3 清单配置
└── src/
    ├── popup/               # 用户界面
    │   ├── index.html       # 结构
    │   ├── style.css        # 样式 (Glassmorphism)
    │   └── main.js          # UI 逻辑与配置持久化
    │
    └── content/             # 注入脚本 (核心逻辑)
        └── content.js       # OOP 设计
```

### 核心类设计 (`src/content/content.js`)
1.  **`Engine`**: 中央调度器。负责状态管理、批次计数、URL 校验。
2.  **`DOMScanner`**: 负责解析 DOM。兼容 `[data-testid="tweet"]` (回复) 和 `[data-testid="UserCell"]` (列表) 两种结构。
3.  **`HoverCardController`**: **(核心)** 处理复杂的悬停交互。
    - 触发 `mouseover` 事件。
    - 轮询等待 `[data-testid="HoverCard"]` 出现。
    - 在卡片内查找关注按钮并执行点击。
    - 触发 `mouseout` 清理现场。
4.  **`Humanizer`**: 提供 `randomDelay` 和 `tinyPause` 等工具函数。
5.  **`Logger`**: 双向日志系统 (Console + Runtime Message + Storage)。

---

## 4. 安装与使用 | Installation & Usage

### 安装步骤
1.  下载本项目源代码。
2.  打开 Chrome 浏览器，访问 `chrome://extensions/`。
3.  开启右上角的 **"开发者模式" (Developer mode)**。
4.  点击 **"加载已解压的扩展程序" (Load unpacked)**。
5.  选择项目根目录。

### 操作指南
1.  打开任意 X (Twitter) 帖子详情页 (例如: `https://x.com/username/status/12345...`)。
2.  点击浏览器右上角的 **X-Follow** 扩展图标。
3.  在面板中配置参数：
    - **Interval**: 建议设置 5-10 秒 (过快易触发验证码)。
    - **Batch Size**: 建议 20-30 人。
    - **Rest Time**: 建议 5-10 分钟。
4.  点击 **"START ENGINE"**。
5.  观察下方的日志终端，查看实时运行情况。

---

## 5. 开发备注 | Dev Notes

- **DOM 选择器**: 由于 X 的类名混淆严重，本项目严格依赖 `data-testid` 属性（如 `tweet`, `User-Name`, `icon-verified`, `HoverCard`）进行定位，这具有更高的稳定性。
- **调试**: 在控制台 (F12) 中，可以使用 `window.XFollowEngine` 访问引擎实例进行调试。
- **日志**: 详细的 Debug 日志会同时输出到 Chrome 控制台（彩色标识）。

---
*Updated: 2026-01-20*

## 6. 用户主页手动采集（v1.1.0）

保留关注、取关和运行记录功能。新增「采集数据」页签，独立于关注引擎运行。默认不采集，需要点击「开始采集」。

### 使用

1. 在 Chrome 111+ 的 `chrome://extensions/` 重新加载本扩展，然后刷新已经打开的 X 页面。
2. 打开用户主页 `https://x.com/用户名`（帖子）或 `https://x.com/用户名/with_replies`（回复）。
3. 点击扩展 →「采集数据」→「开始采集」，再正常浏览、向下滚动。扩展仅在采集期间监听页面自身发出的 `UserTweets` / `UserTweetsAndReplies` GraphQL 请求（fetch / XMLHttpRequest），每次成功响应后自动合并到本地；不会主动调用接口、翻页或点击关注。
4. 点击「停止采集」结束；关闭扩展面板不会停止。切换用户、Tab、页面地址或刷新页面会停止，需重新点击开始。
5. 在「采集数据」查看各用户、各 Tab 的条数、首次及最近采集时间。每个分类可单独「清空」或导出 JSON。清空会停止该分类的采集并保留其他分类；清空后旧响应不会重新写回。

「开始」只记录之后触发的新请求，不补采开始前已加载的内容；请向下滚动加载。再次开始会合并到已有分类，而不是清空已有数据。

导出命名：`用户名_用户ID_posts或replies_YYYYMMDD_HHmmss.json`，例如 `alice_123456_posts_20261019_183000.json`。文件名时间使用电脑本地时间；JSON 时间采用 UTC ISO 8601。每次导出一个用户的一个 Tab，帖子和回复可分别下载。

### 数据规则

- 使用稳定的用户 ID + Tab 分类，同一用户改名后仍进入同一分类，不同用户不会因用户名相同而合并。
- 每个分类按推文 ID 去重；重复采集保留首次时间，更新最新内容及互动数据。较旧响应不会覆盖较新的记录；最新响应缺失的计数为 `null`。
- 每条内容包含 `id`、`url`、`author`、`text`、`publishedAt`、`firstCapturedAt`、`lastCapturedAt`、`metrics`（likes/replies/reposts/quotes/views/bookmarks）、`relationships`、`media`、`source`、原始推文 `raw` 和原始时间线 item 包装 `rawItem`。
- 集合的 `owner` 是当前主页用户，`author` 是内容实际作者。回复线程中的上下文、主页中的转发不会被伪装为该用户原创；引用或转发的嵌套原文保留在 raw 中，不展开成额外记录。广告、游标不算推文。
- 记录接口实际返回的内容，并非完整账号归档；页面缓存若未再次发出请求，不会产生新的采集。开始前已加载的内容不会追溯采集；刷新会停止采集。
- 仅支持上述两个用户时间线接口。X 改动接口名称或响应结构时可能需要更新解析器；若有 GraphQL 错误，无法读取的数据不计为成功。保存失败在采集面板显示。

运行中的采集会话使用 `chrome.storage.session`，浏览器重启后失效。数据使用独立的 `capture:*` 存储键，与关注设置、运行历史互不影响。为保留较多原始 item，使用 `unlimitedStorage` 权限；数据仍占用本机磁盘，不自动淘汰。卸载扩展会移除扩展本地数据，请及时导出备份。扩展不保存请求头、Cookie 或认证令牌，不向外部服务上传采集结果。

### 开发验证

无需安装依赖，Node.js 22+：

```sh
node --test tests/*.test.cjs
```

测试覆盖接口筛选、时间线解析、长正文、互动数据、线程及引用归属、分页去重、用户/Tab 隔离、改名、时间和文件名、fetch/XHR 请求归属及后台并发写入。真实 X 页面仍需在加载扩展后验证，单元测试不代表实时接口兼容性验证。

可选的浏览器集成验证（需要 Playwright 和支持加载扩展的 Chromium；使用临时配置及模拟 X 接口，不访问真实账号）：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chromium node tests/browser-smoke.cjs
```

此测试实际加载扩展，检查脚本注入、默认停止、开始/停止、导航停止、重复响应合并、用户/Tab 隔离、分类清空、面板切换和 JSON 文件下载。
