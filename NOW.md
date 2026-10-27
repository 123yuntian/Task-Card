# NOW.md — 当前状态（最新的一份，不要往上追加历史）

> 每次改完东西，更新这个文件。它是给"下一个接手的 agent"看的第一份文件。
> 历史记录写进 `history/`，不要堆在这里。
>
> **维护约定（2026-10-10 下午约定）**：
> 「下一步」由管家（PM）负责填写和更新，用户不用管。
> 用户只负责更新「今天投入的时间」这一个数字。

---

## 今天日期

2026-10-27（由管家更新；「今天投入的时间」仍由用户填）

---

## 🔴 优先级重排（2026-10-20 23:13 用户当面决定，覆盖 10-16 的「降级」结论）

**本项目 Task Card → 恢复为第一优先，集中精力先做完。**

| 顺位 | 项目 | 路径 | 状态 |
|---|---|---|---|
| **1** | **Task Card** | `C:\Users\10561\Desktop\Task Card\` | **当前唯一主线**，先做完 |
| 2 | Personal Website | `C:\Users\10561\Desktop\Personal Website\`（原 `ai_day1`，10/20 21:51 改名） | Task Card 完成后转为**至少半年的常驻主线**，每天 1 个小功能 |
| 3 | TransLive | `C:\Users\10561\Desktop\TransLive\` | **冻结**，等用户主动提起再介入 |
| 4 | 专业方向 / refractory-lab | — | **冻结**，Task Card 完成后由用户明确事项 |

> 10-16 那份「降级为选修靶子、归档为参考实现」的结论**作废**。
> 证据：用户 10-20 21:58 在本项目提交 `66f8f02`（AGENTS.md 新增第 8 节「两种工作模式 W/S」），
> 21:51 把 `ai_day1` 改名为 `Personal Website` —— 动力源回到了这两个项目上。

---

## 现在在做什么

**Task Card 收尾 → 10/23 起并入「派活系统重构」四场。**

重构的主项目就是 Task Card 本身，不另开项目，直接算收尾的一部分。
原 R-006 / R-004 / R-005 / v2.0 **顺延到重构之后**，不作废、不计欠账。
理由：R-006 要动的 `js/store.js` 正是重构要改字段白名单与保存失败传播的文件，先重构再收 CONFIG，行号不用数两遍。

| 天 | 场次 | 内容 | 预算 | 状态 |
|---|---|---|---|---|
| 10/23 五 | ~~第 1 场~~ | 只读核对，输出五节 + 偏差报告 | 25–30 min | ⏸ 未执行（当晚配 ZCode 子代理 / Magpie 路由）→ 顺延 |
| 10/24 六 | **第 1 场** | 只读核对，输出五节 + 偏差报告 | 25–30 min | ✅ **04:12 完成并验收通过**（scout 27 次核对 → reviewer 首轮 1 阻塞+7 缺口 → 修补 8 条 → 复核通过；管家独立核代码，无谎报） |
| 10/25 日 | **场 2** | 阶段 1–4：备份闸门 → Node 骨架 → 原子持久化 → 发布器 | — | ✅ **完整完成**（`7b89eb1` 15:03 上半 / `71185cd` 16:57 下半；13 文件 +1326/−19；单测 27 + 集成 24；断线一次后恢复） |
| 10/25 夜 | **场 3 上半** | 阶段 5 工作台（`today.html`）+ 阶段 6 前半（工具栏入口，只做 UI） | 90–120 min | ✅ **完成**（`d1bba7e` 22:17，7 文件 +899/−3；`state.json` 有 23:21 的 accept+fail 记录＝他真双击测过） |
| 10/26 一 | **场 3 下半（部分）** | 阶段 6 后半 a + e：字段白名单四字段、v2→v3 迁移 | — | ✅ **a+e 完成并推送**（`db566ac` 10-27 00:48，本人 commit+push，远端 SHA 已核一致） |
| **10/27 二** | **场 3 下半补完** | 阶段 6 后半 **b/c/d**：稳定键 upsert、统一命令入口、保存失败传播（块 B 选做 = 阶段 7 上半） | 40 + 40 min | ← 今天（熄灯日硬边界 23:20） |
| 10/28 三 | 阶段 7 下半 + 阶段 8 收口 | SSE + 多标签冲突 + 单 timer 断言；旧修订标注补齐 | 拆 2 段 | 顺延一天 |
| 10/29 四 | 场 4 | 阶段 9 发布命令（第一步）+ 阶段 10 综合验收 + 回滚演练 | 拆 2 段 | 顺延一天 |
| 10/30 五 | 缓冲 | 补测 / 遗留 / R-006（按重构后新代码重 Grep 行号） | | |
| 之后 | v2.0 | 两视图骨架；R-003 多标签覆盖、R-008 数据导入 | | 顺延不作废 |

> 10/25 白天用户要求"三场全跑"（三个 commit），实际执行结果：**场 2 完整完成（两笔提交）**，
> 15:15 模型不可用断线一次，16:05 恢复后 16:57 收尾；场 3/4 拆成两晚 + 一场。
> **不是欠账**：任务量按实际时间调整，没砍内容只挪日期。
> **L1 审查口径**：场 2 跑了 reviewer + qa-verifier（抓到集成测试重跑不幂等，已修）；场 3 起维持"每场一次"。

> R-006 已顺延两次（10/21、10/22 均未动），本次排到重构之后，**不判失败、不作废**。
> 重构会改 `normalizeTask` 与 `persist`，届时 R-006 必须按新代码重新 Grep 行号，**不沿用本文件旧行号**。
> R-003（多标签覆盖）与 R-008（数据导入）继续挂在 v2.0 之后。

**配套文件（不在仓库内，改前先读）**

- 完整方案：`C:\Users\10561\.workbuddy\plans\cosmic-pulse-tesla-2D6gWOQN.md`
- 四场提示词：`C:\Users\10561\.workbuddy\plans\dispatch-refactor-4-prompts.md`
- 多 Agent 审查：`C:\Users\10561\.workbuddy\plans\dispatch-review-agents.md`
- 今日派活页（**今天用这份**）：`D:\ProgramData\.workbuddy\2026-09-24-20-35-19\projects\vibe-coding\30-today-1027.html`
  （`29-today-1026.html` = 场 3 下半前半（a+e），已执行完；`28-today-1025-night.html` = 场 3 上半；`27-today-1025.html` = 已作废的"四场全跑版"）

---

## 下一步（只写一个动作）

```
【10/27 场 3 下半补完 · 块 A = 阶段 6 后半 b/c/d，块 B（选做）= 阶段 7 上半】
昨夜 `db566ac` 只落了 a（四字段白名单）和 e（v2→v3 迁移），b/c/d 三项经 grep 现场核实**一条都没做**。

0. 开跑前 3 分钟：工作区只应有 `M NOW.md`（管家今天改的文档，**不影响 ZCode 自查，它会连这笔一起提交**），
   业务代码文件必须干净。只需再确认 ZCode 选择器停在 `group/main`（别停在 GLM-5.3-Flash）。
1. 双击 `start.bat` → `127.0.0.1:8317/today.html`，**今天应有两条任务**（块A / 块B，内容修订 r2）。
   铺底已于 10/27 12:0x 由管家完成（`gen-2026-10-27-mvq654kf-c645da`，两条 `available` v0）——
   agent 只需 `GET /api/today` 核对 `published:true`，**不许重发**。
2. 粘派活页 p1（整段）。三项一根链条，缺一环就断：
   **b** `upsertDispatchTask(def, exec)`，键 = dispatchKey，id = `'dp:' + dispatchKey`，只更内容字段、不碰 status/deadline/时间戳；
   **c** `applyTaskCommand({type, dispatchKey, payload})` 统一 accept/complete/fail/delay/shelve，返回 `{ok, saved, taskId}`，
       **禁止事件监听里二次写入**；
   **d** `persist()` 返回 saveData 布尔 → `persistAndEmit` 带 `saved` → workbench 在 `saved===false` 时 toast 改「已同步服务端，但本地保存失败」。
3. 硬约束：只改 `js/store.js` + `js/dispatch/workbench.js`（storage.js 只在 persist 传参处动）；
   **禁改 `js/render.js`（mtime 必须仍是 2026-10-06 18:13）、`js/timer.js`、`server/`**。
4. 自证六条：① /today.html 有两条内容 ② 点接取 → 看板长出卡片（**这条链路至今从未真跑过**）
   ③ F5 倒计时接着走 ④ 三列卡与上一场一模一样 ⑤ 反馈框打一半字去点接取，字还在
   ⑥ 反向：把 localStorage 改坏成非法 JSON 再点接取 → 必须显示「本地保存失败」而不是「成功」。
5. 停下 → 交【待提交清单】+【存档点】→ 管家扫 → 用户图形界面 commit（第 5 笔）。
6. 块 B（选做，21:30 前没开工就放弃）：粘 p2 做阶段 7 上半。**第 0 步不是写 IndexedDB，
   而是把 `repository.mjs` 的 `canonicalOp` 里 `expectedVersion` 从幂等指纹中摘出去**（不摘就做不出"只补一次"），
   改完 27 条单测必须全绿。
7. 硬停点：熄灯日 **23:20 硬线**；只做完块 A 也算打卡。

**10/27 现场核实（管家派活前 grep，不是听自述）**：
· `SCHEMA_VERSION = 3`（storage.js:19）✓ / `normalizeTask` 四字段在 storage.js:105-108 ✓
· `grep -c applyTaskCommand js/*.js` = 0 → c 未做；`grep -rn "saved" js/ server/` = 0 命中 → d 未做；
  `grep -n dispatchKey js/store.js` = 0 → b 未做
· `dispatch-data/state.json` 里唯一那条 accept+fail 的 key 是 `tc-refactor-stage9-10`（**测试夹具 sample.json 的键**），
  不是派给他的两条任务 → **「接取 → 看板出现卡片」这条链路到 10/26 夜为止一次都没真跑过**，
  10/26 记录的"他真双击测过"应更正为"测的是服务端 API 与浏览器迁移，不是两页面间的数据流"
· 铺底时发现并已修正：同一件事顺延**不能改 dispatchKey**（我先改成 `stage6b-rest`，会让昨天执行记录断链，已改回 `tc-refactor-stage6b` 并把 `contentRevision` 升到 2）

**10/28**：阶段 7 下半（SSE + 多标签冲突 + 单 timer 断言）+ 阶段 8 收口。
**场 4 顺延到 10/29**，缓冲到 10/30。
```

> **10/25 夜场复盘（10/26 13:20 更新）**：场 3 上半按期交付并已提交 —— `d1bba7e`（22:17）7 文件 +899/−3，
> 新建 `today.html`（27 行）+ `js/dispatch/{workbench,api}.js`（439+76 行），`index.html` 只加 12 行（工具栏按钮 + body 直下的
> `#dispatch-panel`），`js/render.js` 零改动、`js/timer.js` 零改动 —— 挂载位置与"不动定时器"两条红线都守住了。
> 硬证据不止提交：`dispatch-data\state.json` 里有 23:21 的 `accept` + `fail` 两条操作记录。
> **⚠️ 10/27 更正**：那两条记录的 key 是 `tc-refactor-stage9-10`，是**测试夹具 `server/test/fixtures/sample.json` 的键**，
> 不是当天派的两条任务 → 只能证明"服务端 API 被真调过"，**不能证明"接取 → 看板出现卡片"这条链路跑过**。
> 那条链路到 10/26 夜为止仍然是零次真跑，10/27 才首次验证。
> **唯一没贴回的**是"三列卡一模一样"那条自证 → 今天顺手补，不追究、不加量。
>
> **10/26 13:20 现场核实（本次派活前新查）**：
> · `grep -rn "EventSource|indexedDB" js/ server/` → **零命中**，阶段 7 一行没写（不是"做了一半"）；
> · 阶段 8 其实已八成落地：`workbench.js:334-336` 已有"旧修订（仅供参考）"标注，`import_ai_review`/`confirm_ai_review`
>   已在 `server/schema.mjs:11` 的操作类型里 → 明天只补两条验收断言 + 改版后旧结论置灰，不用重做；
> · 备份真实性质再核一次：`backup\taskcard-localstorage-20261025-145456.json` 仍是**三条默认种子任务**
>   （学习 JavaScript / CSS 布局 / 阅读技术文档，lastResetDate 2026-10-25）→ **看板至今没有真实数据**，
>   所以 v2→v3 那一刀的实际风险是"丢掉三张示例卡"，不是丢他的东西。这条已写进派活页的决策卡。
> · 今日 `dispatch-data/manifest.json` 仍是 `date: 2026-10-25` → 现在打开 `/today.html` 会正确显示「今日尚未发布」，
>   **空态是对的**，别当 bug。今天第 0 步铺底之后才该有内容。

> **第 1 场已验收（04:12）**：五节方案属实，管家独立核过 9 条 file:line，无谎报、无越界。
> 两个真发现：①文档写 `deadlineTs`、代码是 `deadline`（场 4 修文档）；
> ②**那份备份是 3 条默认种子任务（version:2 / tasks:3 / lastResetDate:2026-10-24 / taskStates:null），不是你真实用过的数据**
> —— 说明 Task Card 你其实没真用起来，备份闸门的安全价值被高估，但仍须以浏览器现场为准。
> 遗留非阻塞 4 条（T-1~T-4）场 3 实现时收口。

```
R-006 / R-004 / R-005 / v2.0 全部顺延到四场之后，本文件不再保留它们的旧行号。
```

- **今天（周一）是熄灯日**：晚上块硬边界 23:20，需要网络的步骤排在之前。
- 备份现状（10/26 13:20 第三次核）：`backup\` 里两份导出 **都是默认种子数据** ——
  `taskcard-backup-20261024.json`（1661B，已被 `28c005a` 提交）与 `taskcard-localstorage-20261025-145456.json`（2049B，10/25 14:54 亲手导），
  内容均为 `version:2 / tasks:3 / lastResetDate` 当天 / `taskStates:null`，三条任务仍是「学习 JavaScript 基础 / CSS 布局练习 / 阅读技术文档」。
  **结论：看板至今没有真实使用数据** → v2→v3 的实际风险 = 丢掉三张示例卡，不是丢他的东西。
- 环境现状（10/26 13:20 复核）：系统 node = `C:\Program Files\nodejs\node.exe` **v24.21.0**（`start.bat` 绑的就是它）；
  WorkBuddy 自带的 `C:\Users\10561\.workbuddy\binaries\node\versions\22.22.2-6\node.exe` = v22.22.2（**不要绑进 start.bat**）；
  项目仍无 `package.json`；`dispatch-data\` 已被 .gitignore 排除（运行数据不入库）。
- 判断标准（场 3 下半）：① `/today.html` 今天有内容且不是拿 10-25 冒充 ② 接取后看板出现卡片、F5 倒计时连续
  ③ 重复导入不新增重复卡 ④ 三列卡与倒计时与上一场完全一致（动了 render.js 就会缺东西）。
- **阶段 7 现状（10/26 实测）**：`grep -rn "EventSource|indexedDB" js/ server/` 零命中 → 一行未写，不是"做了一半"。
- **阶段 8 现状（10/26 实测）**：已约八成落地 —— `workbench.js:334-336` 有「旧修订，仅供参考」标注，
  `server/schema.mjs:11` 已有 `import_ai_review` / `confirm_ai_review` 操作类型，`REVIEW_LABEL` 有 pending/passed/changes_requested。
  明天只补验收断言与"改版后旧结论置灰"，不重做。
- 模型：主会话走路由组 `主实现-main`（GLM-5.3，免费额度），不满意再手动切 Claude Opus 5.5；
  审查用 `审查-review` 只读、冲突裁决用 deepseek-v4-pro。**全程禁用「完全访问」**，发现越界就降到「变更前确认」。
- 工具锁：ZCode（W/S 模式）+ WorkBuddy（派活/验收），冻结到 2027-01-17。

---

## 今天投入的时间

**___ 分钟**（由用户填）

---

## 上一次跑通的版本

- **10/25 打卡判定：已打卡（三选二：产出 + 提交）。场 3 上半完整交付。**
  `d1bba7e`（10-25 22:17，用户本人提交）「派活重构场3上半：固定工作台(today.html)+ Task Card 接入」，
  7 文件 **+899/−3**：`today.html`(27) / `js/dispatch/api.js`(76) / `js/dispatch/workbench.js`(439) /
  `index.html`(+12) / `style.css`(+256) / `server/main.mjs`(+35) / `server/publisher.mjs`(+57)。
  **`js/render.js` 与 `js/timer.js` 零改动** → 两条红线（不整块重建容器、不新增定时循环）都守住。
  提交后 23:21 有 `dispatch-data\state.json` 的 accept + fail 记录 → 他真双击起服务点过，不是"agent 写完就提交"。
- **10/26 打卡判定：已打卡（三选三：产出 + 亲手 commit/push + 真机验证）。场 3 下半只完成 a+e。**
  `db566ac`（**10-27 00:48**，本人 commit + push，`git ls-remote origin HEAD` 已核为同一 SHA）「派活重构场3下半：数据模型 v2→v3」。
  agent 自行发现 `exportData` 硬编码 `version:2` 并改读 `SCHEMA_VERSION`（范围内必改、主动抓到）。
  隔夜验证：Node 四路径（v2→v3 / v1 兼容 / v4→T-3 只读 / store 全流程）+ 浏览器迁移前后逐字段 diff + 导出 version:3。
- 最新提交：`db566ac`（10-27 00:48 场 3 下半 a+e）；上一笔 `1f9fc5c`（10-26 22:59 Update NOW.md）；
  再上 `d1bba7e`（10-25 22:17 场 3 上半）/ `0d15d95` / `71185cd`（场 2 下半）/ `7b89eb1`（场 2 上半）/ `28c005a`。
- **10/24 打卡判定：已打卡（三选二）** —— 亲手导出 localStorage 备份 + 产物文件落盘。
- **10/23 打卡判定：打卡成立（分级口径）+ 第 1 场内容顺延** —— 当晚产出全在工具链上（三个 ZCode 子代理 + Magpie 路由组），
  有文件有配置，但第 1 场零输出；原样顺延，不问责。
- **10/22 打卡判定：已打卡（三选三）** —— `a1faa5c` 两行全改 + 亲手 commit + `d85d0ff` 提交 NOW/AGENTS。
- 截至 10/27 12:0x 工作区只有 `M NOW.md`（管家本轮改写：日期 / 四场表 / 下一步 / 现场核实 / 打卡判定，不含业务代码），
  **待用户提交** —— 这笔不用单独提，跟今天块 A 一起 commit 即可（工作区"脏"不影响 ZCode 自查，它只查代码文件）。
- **业务代码自 10/25 15:12 起重新动起来了**：`js/app.js`（T-3 横幅）、`js/storage.js`（守卫）、
  `index.html`（工具栏）、新增 `js/dispatch/*` 与 `server/*`。此前"最后一行业务改动 = 2026-10-10 19:37"的记录作废。
- 接手测试结论（管家 10-11 亲验）仍然有效：框架文件齐全，新 agent 只给路径即可答对三问。

---

## 卡在哪 / 需要谁帮忙

- **没有技术阻塞。** 阶段 1–5 与阶段 6 前半已过，备份闸门 10/25 14:54 已完成。
- 当前唯一需要人来做的事：**v2→v3 那一刀要你点头**（D-009 承诺，管家已在派活页给出 A/B 两案与推荐）。
  agent 不许自己决定版本号。
- 接手测试已结案（管家 10-11 亲验）：三问全对、只读 5 个文件 → 框架成立。
- v2.0 前置条件：R-001 ✅ 已修、R-002 ⛔ 作废 → 前置已解除，但 v2.0 排在四场重构之后。
- 支线封存：TRAE / Qoder / Hermes Agent / Our Free Model / Magpie —— 一律不展开，工具组合冻结至 2027-01-17。

---

## backlog（四场跑完之后再做，现在别插队）

1. **一键备份按钮**：`index.html` 加一个「导出备份」按钮，点一下直接下载 json，
   并在页面上显示 `origin / tasks 数 / schemaVersion` 三个数。
   现状要 5 步手工（双击 bat → F12 → 粘一行 → 挪文件 → 核数字），改完是 1 步点。
   **为什么现在不做**：它要改 `index.html`，而场 3 的阶段 6 也要改 `index.html` 工具栏 —— 现在插进去会撞车。
2. **备份彻底去手工化**：阶段 3 起数据落到 `dispatch-data\`，阶段 7 起前端有 IndexedDB 缓存 ——
   跑完之后"备份"就等于复制一个目录，连浏览器都不用开。这条不需要额外开发，是四场的副产品。

> 阶段 1 的浏览器导出**今天只做这一次**，属一次性闸门，不是日常动作。
> 它也不能自动化：① Node 服务跑在浏览器外面，读不到 localStorage；
> ② 让它自己导出 = 让它同时当"改动方"和"取证方"，这份备份就失去证据价值。
