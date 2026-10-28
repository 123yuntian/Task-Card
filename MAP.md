# MAP.md — 模块依赖 / 数据流 / 事件表

## 1. 模块依赖（谁 import 谁）

```
        index.html
             │  <script type="module">
             ↓
          js/app.js  ──────┬──────────┬───────────┐
             │             │          │           │
             ↓             ↓          ↓           ↓
        js/store.js   js/timer.js  js/render.js  (无)
             │
             ↓
        js/storage.js ──> localStorage["taskCardData"]
```

- `app.js` 是唯一入口，按 **store.init() → timer.start() → render.init()** 顺序启动。
- `store.js` 依赖 `storage.js`（读写盘），**不依赖** render / timer。
- `render.js` 依赖 `store.js`（读数据 + 订阅事件），**不直接碰** storage。
- `timer.js` 是独立引擎，只对外发 `onTick`，不知道任务的存在。

**依赖方向是单向的，不能反向 import。** 想让 timer 知道任务，只能在 app.js 里接线。

## 2. 一次点击的完整数据流（以「按 A 接取任务」为例）

```
用户按 A
   │
   ↓
render.js（事件委托）捕获 keydown
   │  调用
   ↓
store.acceptTask(id)
   │  ① 校验状态机是否允许 available → accepted
   │  ② 计算 deadlineTs = Date.now() + suggestedTime*60000
   │  ③ 修改内存里的 state.tasks
   │  ④ persist()   → storage.saveData()  → localStorage
   │  ⑤ emit('change')
   ↓
render.js 的 'change' 监听器收到
   │
   ↓
重新渲染任务卡 DOM（局部，不是整页）
```

**关键：视图层永远不自己改数据，只能调用 store 的方法。** 这是单向数据流。

## 3. 事件表

| 事件名 | 谁发 | 什么时候发 | 谁在听 | 载荷 |
|--------|------|-----------|--------|------|
| `change` | `store.js` 内部 `persistAndEmit()` | 任何数据变化后 | `render.js` | 无（监听者自己 `getTasks()` 重新取） |
| `task:expired` | `store.js` 的 `dailyResetIfNeeded()` 或倒计时判定 | 倒计时归零 | `render.js`（弹模态框） | 任务对象 |

⚠️ 已知问题：跨天时 `dailyResetIfNeeded()` 内部先为每个过期任务 emit 一次 `task:expired`，
末尾 `persistAndEmit` 又广播一次 `change`，监听器会收**两轮**事件。见 `RISK.md` R-004。

## 4. v2.0「统一学习工作台」设计（已定，未开工）

```
┌─────────────────────────────────────────┐
│  [任务卡] [工作台]        Ctrl+1 / Ctrl+2 │  ← 顶部 Tab
├─────────────────────────────────────────┤
│                             │            │
│      当前视图的内容          │  右侧状态条 │
│                             │            │
└─────────────────────────────────────────┘
```

四条原则：
1. **单一真源**：只有 `store.js` 里的 `state`。切视图 = 换一个渲染函数，**不复制数据**。
2. 视图名存 `settings.view`（localStorage），刷新后停在原来的视图。
3. 四条跨视图联动：
   - 任务卡接取 → 工作台生成对应「施工单」
   - 工作台点「我已改完」→ 任务卡变「待验收」+ 弹出验收话术
   - 工作台完成 → 任务卡清空 + 进度 +1
   - 倒计时**跨视图同步**（同一个 deadlineTs）
4. 快捷键：`Ctrl+1` / `Ctrl+2` 切视图，`Shift+F` 搜索。

开工前置条件：先修完 `RISK.md` 的 R-001 与 R-002。

## 5. 数据契约（v2.0 要把 DEFAULT_TASKS 换成这个）

```js
window.TASK_DATA = {
  version: 1,
  date: '2026-10-10',
  title: '', subtitle: '',
  tasks: [{
    id, track: 'web' | 'refractory' | 'mc',
    title, tags: [], goal, advice,
    actions: [], prompt,
    knowledge: [{ term, desc, hint }],
    promptLesson, dueText, minutes, requires: []
  }]
}
```

每张卡 5 段：目标 / 建议 / 措施+提示词 / 知识点+「提示词这样写」/ 建议完成时间。

## 6. 派活链路（2026-10-28 现状 · 场 1–9 完成后的真实结构）

```
浏览器
 ├── index.html ──> js/app.js ──> store/render/timer ──> localStorage["taskCardData"]
 │                     └──（今日派活面板）──> js/dispatch/workbench.js
 └── today.html ─────────────────────> js/dispatch/workbench.js
                                            │
                                            ├─> js/dispatch/api.js  ──> HTTP /api/*
                                            ├─> js/dispatch/client-store.js ──> IndexedDB（快照 + 待同步队列）
                                            └─> js/store.js（upsertDispatchTask / applyTaskCommand）──> localStorage

server/main.mjs（零依赖 HTTP，127.0.0.1:8317）
 ├─> Publisher  ──> dispatch-data/manifest.json + published/<gen>/{definition.json,tasks.html}
 ├─> Repository ──> dispatch-data/state.json（原子写：备份 .bak → tmp+fsync → rename）
 └─> SSE /api/events ──> 推给 today.html（看板不吃 SSE，吃 storage 事件）

server/publish.mjs（命令行）──> 复用同一个 Publisher，发布/预览
```

| 文件 | 职责 | 不许做什么 |
|---|---|---|
| `server/main.mjs` | HTTP 路由、静态白名单、写令牌、SSE | 不放业务规则 |
| `server/publisher.mjs` | 校验 → 生成 → 原子切换 manifest | 不碰执行状态 |
| `server/repository.mjs` | 执行状态唯一真源、幂等、版本冲突 | 不生成 HTML |
| `server/schema.mjs` | 定义校验 + 操作 payload 校验 | 不做 IO |
| `server/publish.mjs` | 命令行发布入口 | 不扫目录、不执行命令、不接受目录参数 |
| `js/dispatch/workbench.js` | 今日派活 UI（两个页面共用） | 不重建整块、不写循环定时器 |
| `js/dispatch/client-store.js` | IndexedDB 快照 + 队列 | 不用 localStorage 模拟事务 |

## 7. 两套真相（最容易踩的坑，2026-10-28 用户实际撞到）

- **服务端 `dispatch-data/state.json`** = 执行状态真源，`today.html` 读它。
- **浏览器 `localStorage["taskCardData"]`** = 看板的**投影副本**，`index.html` 读它；派活卡 id 形如 `dp:<dispatchKey>`。
- 只有「接取 / 完成 / 失败 / 搁置」这类操作会让前端**顺带写一次** localStorage。
  所以：从其他途径改服务端（重置沙箱、重新发布、命令行发布、换设备）时，**看板不会自动跟着变**。
- 同一浏览器多标签之间：靠 `storage` 事件同步（D-012）。
- 跨设备 / 跨浏览器：不同步。根治办法是"打开看板时按服务端快照对齐一次"，排在 v2.0。
