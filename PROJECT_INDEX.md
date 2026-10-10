# PROJECT_INDEX.md — 文件清单与职责

> 行数统计于 2026-10-10。文件变大时更新本表。

## 根目录

| 文件 | 行数 | 职责 | 谁先读 |
|------|------|------|--------|
| `index.html` | 35 | 页面骨架：工具栏、任务容器、失败栏、模态框挂载点、toast | 要先看结构时 |
| `style.css` | 384 | 全部样式（无预处理器、无框架） | 改外观时 |
| `AGENTS.md` | — | **agent 入口文档**，含硬约束与阅读顺序 | 每次接手第一个读 |
| **`CONVENTIONS.md`** | — | **🔴 AI 写代码规则库，唯一真源** | **改代码前必读** |
| `NOW.md` | — | 当前状态与下一步 | 每次接手第一个读 |
| `MAP.md` | — | 模块依赖 / 数据流 / 事件表 | 改数据流时 |
| `RUNBOOK.md` | — | 怎么跑、怎么提交、故障排查 | 跑不起来时 |
| `DECISIONS.md` | — | 技术决策记录 | 想改架构前 |
| `RISK.md` | — | 已知隐患清单 | 每次接手扫一眼 |
| `PROJECT_INDEX.md` | — | 本文件 | — |
| `STORE-NOTES.md` | 71 | 10-09 由 agent 生成的 store.js 数据流分析（只读参考） | 研究 store 时 |

## js/ 目录（全部是 ES Module）

| 文件 | 行数 | 职责 | 关键导出 |
|------|------|------|----------|
| `js/app.js` | 22 | **入口**。只做一件事：按 store → timer → render 顺序初始化 | 无（自执行） |
| `js/store.js` | 383 | **单一数据源**。持有全部任务数据、状态机、发布订阅、持久化 | `init` `on` `getTasks` `getTask` `getBlockers` `addTask` `updateTask` `deleteTask` `acceptTask` `completeTask` `delayTask` `shelveTask` `failTask` `reacceptTask` `dailyResetIfNeeded` `exportData` |
| `js/render.js` | 389 | **视图层**。订阅 store 事件，渲染 DOM，事件委托处理点击 | `init` |
| `js/storage.js` | 104 | **持久层**。localStorage 读写、JSON 序列化、版本迁移、异常容错 | `loadData` `saveData` `loadLegacyStates` `clearLegacy` `SCHEMA_VERSION` |
| `js/timer.js` | 63 | **倒计时引擎**。全局唯一的 setInterval，每秒 tick | `onTick` `start` `stop` |

## 其它

| 路径 | 说明 |
|------|------|
| `.github/ISSUE_TEMPLATE/` | 4 个模板：`inbox.md` / `bug_report.md` / `feature_request.md` / `config.yml` |
| `history/` | 改动流水账，一天一个文件 |
| `.gitattributes` | 66 字节，10-05 初始提交时建 |

## 搜索关键词速查（给 agent 用）

| 想找什么 | Grep 关键词 |
|----------|-------------|
| 规则库 | `CONVENTIONS.md` |
| 默认任务数据 | `DEFAULT_TASKS` |
| 状态机流转 | `acceptTask` / `completeTask` / `failTask` |
| 持久化写入 | `saveData` / `persist` |
| 倒计时 | `deadline` / `onTick` |
| 事件广播 | `emit(` / `on(` |
| 导出 JSON | `exportData` |
| 版本迁移 | `migrate` / `SCHEMA_VERSION` |
| 日期计算 | `toISOString` / `lastResetDate` |

## 合规自检（每次交付前跑一遍）

| 检查 | 命令 | 期望 |
|---|---|---|
| 入口未被改成非 module | `grep 'type="module"' index.html` | **必须有结果** |
| 无残留 UTC 时间戳 | `grep -rn "toISOString" js/` | 只在明确标注为机器同步处出现 |
| 只有一处定时器 | `grep -rn "setInterval" js/` | 只在 `js/timer.js` |
| 存储键名没被改 | `grep "STORAGE_KEY" js/storage.js` | 应为 `taskCardData` |
