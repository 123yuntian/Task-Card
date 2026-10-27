# AGENTS.md — 接手前先读这一页

> **2026-10-28 瘦身版**：原版 148 行 / 8.5KB → 现 120 行 / 6.2KB。
> 单看本文件只减 27%；**真正的收益是取消了"开场必读 CONVENTIONS + NOW"** ——
> 单次会话的入场上下文从 **36.9KB（AGENTS+CONVENTIONS+NOW）降到 6.2KB，减 83%**。
>
> 为什么砍：① ETH Zurich 2026 研究显示，过长的 instruction 文件**总体不提升成功率，反而让成本涨 20%+**；
> ② `NOW.md`（18KB）和 `CONVENTIONS.md`（9.9KB）每天在变，每开一个新会话读它们，**都在破坏 prompt 缓存前缀**，
> 实测让缓存命中率掉到 70%（目标 70%+，同类会话可达 94%）。
> → 规则库还在 `CONVENTIONS.md`，但**不再要求开场通读**；需要时按规则编号 Grep 那一条。
> → 当天干什么，看**任务卡**（`/today.html` 或用户贴的提示词），**不要读 `NOW.md`**。

---

## 0. 开跑前只做三件事（不要多读）

1. `git status` —— 必须干净。有未提交改动先停下来告诉用户，别在脏树上动手。
2. `git log -3` —— 看清上一笔做了什么。
3. 读用户给的**任务卡 / 提示词**。里面已经写了背景、边界、验收；不需要自己去猜。

**不要**开场通读 `CONVENTIONS.md` / `NOW.md` / `MAP.md` / `DECISIONS.md`。
需要某条规则时：`Grep "R-00x" CONVENTIONS.md` 取那一条。

---

## 1. 这个项目是什么

一个**任务卡看板** + 本地 Node 零依赖服务：

- 前端：纯静态 ESM，`index.html`（看板）/ `today.html`（今日派活工作台）
- 服务端：`server/main.mjs`（零第三方依赖，默认 `127.0.0.1:8317`）
- 运行数据：`dispatch-data/`（已 gitignore，**不要手动改**）

- 路径：`C:\Users\10561\Desktop\Task Card\`
- 远程：https://github.com/123yuntian/Task-Card

---

## 2. 跑起来 / 跑测试（只有这几个命令）

```bash
# 起服务（用户双击 start.bat 等价）
node server/main.mjs                 # 默认 8317；PORT=8318 node server/main.mjs 可换端口

# 单元测试（27~28 条，含 T-3 守卫、发布器、仓储）
node server/test/phase3-4.test.mjs

# 集成测试（25 条，在 8321 沙箱跑，不碰真实 dispatch-data）
node --test server/test/integration.test.mjs
```

**改了 `server/` 下任何文件 → 必须重启服务才生效**（Node 已把模块载入内存）。

---

## 3. 硬约束（违反必炸，按踩坑频率排）

1. **入口是 ES Module** → `file://` 双击必然白屏。只能走本地服务或 GitHub Pages。
   不要为了"能双击"改成非 module，那是倒退。
2. **localStorage 键 = `taskCardData`**；`SCHEMA_VERSION` 在 `js/storage.js`（**当前 = 3**）。
   改数据结构必须 +1，并在 `migrate()` 补一条迁移分支。`normalizeTask` 里新字段一律 `|| null`，
   **不能留 `undefined`**（`JSON.stringify` 会把 undefined 键丢掉）。
3. **禁止用 `toISOString()` 生成本地日期**（输出 UTC，东八区 08:00 前算错一天）。
   日期一律 `getFullYear/getMonth/getDate` 拼接。
4. **全局只能有一个 `setInterval`**（`js/timer.js`）。它的 tick 里禁整页重渲染，只更新倒计时文本。
   toast 用的 `setTimeout` 是一次性的，不算循环定时器。
5. **倒计时只存绝对截止时间戳**，剩余时间实时算 `deadline - Date.now()`。禁止存剩余毫秒数。
6. **服务端写操作必须带令牌**：`GET /api/session` 领取，写请求带 `x-dispatch-token`。
   `Host` 与 `Origin` 双校验、静态白名单、T-3 只读守卫 —— **一个都不许弱化**。
7. **会话中途不要换模型 / 改推理档位 / 改 MCP 配置**。
   每一次改动都会让 prompt 缓存前缀失效，下一次请求全量重算。要换就开新会话。

---

## 4. 两种工作模式（每次回复第一行必须标明）

| 模式 | 什么时候用 | 允许 | 绝对禁止 |
|---|---|---|---|
| **W · 许愿造轮** | "我要一个 XX 功能""还缺个模块" | 新建 1–3 个文件、组织目录、入口加一行引用 | 改已有文件的内部逻辑；一次加 >3 个文件 |
| **S · 单文件外科** | "这个文件有 bug""第 X 行""这段改一下" | 读单文件、定位行号、最小改动、给改前→改后 | 新建文件、改目录结构、顺手改别的文件 |

**判定**：缺功能 → W；某处不对 → S；改值/文案/颜色 → 用户自己改（3 秒，不开 AI）。

**交接纪律**：串行（同一时刻只有一个模式动这个文件）；用户 commit 才是交接棒；W 每次先重读目录树。

---

## 5. 交付要求

1. 报**文件:行号** + **改前→改后**原文对照（只贴改动段）。
2. **不要自己 `git commit`** —— 用户在图形界面看 diff 后自己提交。
3. 发现范围外的问题，**写出来告诉用户，不要顺手改**。
4. 只报告真实执行过的测试。**没跑就写"未跑"**，不要用"应该""推测"替代输出。
5. 结尾必带：**如果你还有任何问题或建议，先向我提出，解决所有分歧和阻塞后再执行任务。**

---

## 6. 文件地图（**需要时再读，不要开场全读**）

| 文件 | 什么时候读 |
|---|---|
| `CONVENTIONS.md` | 需要某条具体规则时，Grep 规则编号取一条 |
| `DECISIONS.md` | 想知道"为什么这么设计"时，按 D-00x 查 |
| `RISK.md` | 要动一个已知有坑的地方时 |
| `MAP.md` | 要跨模块改动时 |
| `RUNBOOK.md` | 起不来 / 提交不了时 |
| `NOW.md` | **默认不读**。它是给人看的进度页，内容每天变，读了会让缓存失效 |

---

## 7. 这个项目最容易做错的四件事（血泪，按频率）

1. **改完一步就停**，不跑测试、不报输出 → 交付前自查：有没有贴出 `SUMMARY` 行 / `git diff --stat`。
2. **顺手重构** → 只改被要求的那一处，其它发现写出来别动。
3. **在脏工作区动手** → 开场 `git status` 必须空。
4. **验证靠推演不靠运行** → IndexedDB 之类浏览器专有的代码，Node 里怎么跑见下条备注。

> 备注：`js/dispatch/client-store.js` 这类浏览器 IndexedDB 代码，可以在 Node 里真跑：
> `npm i fake-indexeddb` 后 `import 'fake-indexeddb/auto'` 再动态 import 目标模块，调它的 `__selftest()`。
> 比"语法检查 + 推演"强一个量级。
