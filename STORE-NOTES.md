# js/store.js 数据流说明

> 本文描述 `js/store.js` 在整个应用中的数据流向。store 是**单一数据源**：内存中的 `state` 是唯一可写副本，视图层只读，不持有任何业务状态。

## 分层

```
render.js（视图）  ──调用──>  store.js（状态）  ──调用──>  storage.js（localStorage）
     ^                            │
     └──── 事件订阅 'change'/'task:expired' ────┘
```

- **render.js**：只负责 DOM 渲染与事件委托，不修改数据；所有用户操作都转成对 store 的调用。
- **store.js**：持有 `state`，提供 CRUD 与状态机迁移方法，是唯一写 `state` 的地方。
- **storage.js**：只做序列化与 localStorage 读写，不理解业务字段含义。
- **timer.js**：每秒 tick，读取任务 `deadline` 做过期判定，并通过 `store.failTask()` 回写状态。

## 启动时的流入

```
localStorage ──loadData()──> migrate(版本升级) ──> normalizeTask(字段补全) ──> state.tasks
                                    │
                                    └─ 无数据/损坏 ──> DEFAULT_TASKS 播种 ──> applyLegacyStates()
```

`init()` 的三条分支：磁盘有合法数据则逐条 `normalizeTask` 后载入；数据缺失或损坏则用内置示例任务兜底，并尝试把重构前的旧键 `taskStates` 迁移过来（旧 id `1/2/3` → 新 id `t1/t2/t3`）；最后统一执行 `dailyResetIfNeeded()`。任何来源的任务对象都会经过 `normalizeTask` 补齐字段，因此脏数据不会污染内存状态。

## 写操作的统一出口

所有变更状态的导出方法（`addTask` / `updateTask` / `deleteTask` / `acceptTask` / `completeTask` / `delayTask` / `shelveTask` / `reacceptTask`）都收敛到同一个出口：

```
mutate state ──> persist() ──> emit('change', { type, id })
```

即**先落盘再广播**，保证监听者拿到事件时数据已经持久化。`failTask` 是唯一例外：它在广播 `change` 之后再额外广播 `task:expired`，供视图层弹出"延时 / 搁置"模态框。

## 读操作与倒计时

视图层通过 `getTasks()` / `getTask(id)` / `getBlockers(task)` 读取状态。注意 `getTasks()` 返回的是**内部数组引用**，调用方只能读，不能就地修改，否则会绕过 `persistAndEmit` 导致数据不落盘、视图不刷新。

倒计时不存"剩余秒数"，只存绝对截止时间戳 `deadline`，剩余时间由视图层实时计算：

```
remaining = task.deadline - Date.now()
```

`timer.js` 每秒 tick 时用同一公式做过期判定，命中则调用 `store.failTask(id)`；页面休眠、刷新或系统时间调整都不会破坏正确性。

## 状态机与迁移路径

```
available ──acceptTask──> accepted ──completeTask──> done
                              │
                              ├── deadline 到期（timer 或每日重置）──> failed
                              └── shelveTask ──> shelved

failed / shelved ──reacceptTask──> available
failed / shelved ──delayTask(ms)──> accepted（重新计时）
```

`failed` 与 `shelved` 在视图层都被渲染到"失败任务栏"。`acceptTask` 会先做依赖检查：若 `blockedBy` 中存在未完成任务，则拒绝接取并返回阻塞列表。

## 两条广播事件

| 事件 | 触发时机 | 载荷 | 用途 |
| --- | --- | --- | --- |
| `change` | 任何状态写操作后 | `{ type, id }` | 视图层整体重渲染 |
| `task:expired` | 任务判定失败时 | `{ id }` | 视图层弹出延时/搁置模态框 |

订阅通过 `on(event, handler)`，返回取消订阅的函数。
