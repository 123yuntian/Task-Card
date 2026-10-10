# 我的任务卡 / 统一学习工作台

**[给我自己用的每日任务看板：接取任务后开始倒计时，逼我别拖。] 用一句你自己的话写：这个东西是给谁用的、解决什么问题（≤ 30 字）**

---

## 它现在能做什么

1. 展示当天的任务卡（默认 3 条示例任务，`js/store.js:50` 的 `DEFAULT_TASKS`）。
2. 鼠标悬停选中卡片后，按 **A 接取 / C 完成 / D 延时**。
3. 接取后开始倒计时，倒计时归零 → 任务进「失败任务栏]。
4. 失败 / 搁置的任务可以「重新接取」。
5. 每天首次打开时做一次日切重置。
6. 「导出数据」按钮下载一份 JSON。

## 状态机

```
available（待接取）──A──> accepted（进行中）──C──> done（已完成）
                              │
                        倒计时归零
                              ↓
                          failed（失败）──D/搁置──> shelved（已搁置）
                              │                        │
                              └──────  重新接取  ───────┘
                                          ↓
                                     available
```

## 怎么跑起来

⚠️ **不要双击 `index.html`** —— 入口是 ES Module，file:// 下会被 CORS 拦住，一定白屏。

三种正确方式（详见 `RUNBOOK.md`）：
1. **CodeBuddy 预览面板**：`http://localhost:8317/index.html`（推荐，改完立刻看）
2. **任意本地服务器**：在项目目录起一个静态服务再访问
3. **GitHub Pages**：push 到 main 后访问线上地址

## 技术栈

- 零依赖、零构建、纯静态。原生 HTML + CSS + ES Module JavaScript。
- 数据只存在浏览器 localStorage，键名 `taskCardData`。**换浏览器 / 清缓存 = 数据没了**。

## 目录结构

```
Task Card/
├── index.html          页面骨架（35 行）
├── style.css           全部样式（384 行）
├── js/
│   ├── app.js          入口（22 行）
│   ├── store.js        数据源 + 状态机（383 行）
│   ├── render.js       视图层（389 行）
│   ├── storage.js      持久层（104 行）
│   └── timer.js        倒计时引擎（63 行）
├── AGENTS.md           ← agent 接手先读这个
├── NOW.md              当前状态
├── MAP.md              数据流
├── RUNBOOK.md          怎么跑 / 怎么提交
├── DECISIONS.md        决策记录
├── RISK.md             隐患清单
├── PROJECT_INDEX.md    文件索引
└── history/            改动流水账
```
