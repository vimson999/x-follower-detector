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
