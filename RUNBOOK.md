# RUNBOOK.md — 怎么跑 / 怎么提交 / 出故障怎么办

## 1. 怎么跑起来

> **2026-10-28 起，日常就一种：双击 `start.bat`。** 它现在会自己判断——
> 端口空着就起服务并开浏览器；端口已被占用且对方应答是 Task Card，就直接开浏览器、不动进程；
> 被别的程序占着才提示。**任何情况下都不要去任务管理器杀 `node.exe`**（会连带杀掉别的服务）。
> 页面看起来是旧的？按 `Ctrl+F5` 强刷。

### ✅ 方式一：CodeBuddy 预览面板（日常用这个）

1. 在 CodeBuddy 里打开 `C:\Users\10561\Desktop\Task Card\`
2. 打开预览面板，访问 `http://localhost:8317/index.html`
3. 改完保存，刷新就能看到

### ✅ 方式二：任意本地静态服务器

项目目录里起一个 HTTP 服务再访问 `index.html`。任何静态服务器都行。

### ✅ 方式三：GitHub Pages（线上）

push 到 main 分支，等一两分钟，访问 Pages 地址。
远程：`https://github.com/123yuntian/Task-Card`

### ❌ 明确禁止：双击 `index.html`

`index.html:33` 是 `<script type="module" src="js/app.js">`，
浏览器在 `file://` 协议下会以 CORS 策略拒绝加载 module 脚本 → **白屏，控制台报 CORS 错误**。

这是**设计选择，不是 bug**。ES Module 带来的模块化收益远大于"能双击"这一点便利。
**解决办法是起服务器，不是把 module 拆掉。**

## 2. 怎么提交（每次改动都要走一遍）

1. CodeBuddy 左侧「源代码管理」面板
2. 看一眼 diff：确认只改了你想改的文件，没有夹带
3. 提交说明写**一句人话**，例如：`把导出时间改成北京时间，不再差 8 小时`
4. 点 Commit
5. **需要让管家验收时，先 commit 再喊「验收」** —— 没 commit 就只能看到"现在是什么样"，看不到"改了什么"

## 3. 常见故障

| 现象 | 原因 | 怎么办 |
|------|------|--------|
| 打开白屏 | 双击了 `index.html`（file:// + ESM） | 改用方式一/二/三 |
| 控制台报 CORS | 同上 | 同上 |
| 改了代码没变化 | 浏览器缓存 | 硬刷新 `Ctrl+Shift+R` |
| 数据全没了 | 换了浏览器 / 清了缓存 / 换域名 | 正常，localStorage 按域名隔离。重新播种即可 |
| 倒计时不准 | 页面切后台被浏览器节流 | 正常现象。倒计时存的是绝对时间戳，回来会自动校正 |
| 多开两个标签页，改动丢失 | `state` 每标签页一份内存副本，后写者全量覆盖 | 见 `RISK.md` R-003。**当前无解，别同时开两个标签页改** |
| 凌晨 0–8 点日期差一天 | `toISOString()` 输出 UTC | ✅ 已修（10-10 `e467596`，见 `RISK.md` R-001）；改完线上没变化先按 `Ctrl+Shift+R`（Pages 缓存 600 秒） |

## 4. 改数据结构时的固定动作

1. `js/storage.js` 里 `SCHEMA_VERSION` **+1**
2. `migrate()` 里补一条从旧版本升级的分支
3. 提交说明里写清楚"数据结构 v2 → v3，改了什么"

不这么做的话，老用户的数据会被静默丢弃，回到默认任务。

## 5. 备份 / 恢复

- 备份：点页面上的「导出数据」，拿到 JSON 存到别处
- 恢复：目前没有导入按钮（缺失功能），只能手动改 localStorage

## 6. 发布今天的派活（命令行）

```bat
node server\publish.mjs "C:/某个路径/definition.json"            :: 真发布
node server\publish.mjs "C:/某个路径/definition.json" --dry-run  :: 只看差异，不写盘
```

- 必须是**绝对路径 + .json 文件**（不接受目录、通配符）；校验不过会列全部错误并退出码 1，不写任何文件。
- 发布成功后**服务不用重启**：`/today.html` 下次请求就会读到新 manifest（实测）。
- 失败时旧内容原样保留（实测：manifest mtime 不变、旧 generation 仍是当前）。
- 发布失败最常见的原因：`dispatchKey` 重复、`minutes` 不是正数、`date` 不是 `YYYY-MM-DD`。

## 7. 测试沙箱（想随便点就用它）

双击桌面 `TaskCard-sandbox.bat` → 复制整份项目到 `%TEMP%\tc-sandbox` → 在 **8320** 起服务（真实 8317 的数据只被读、不被改）。
页面右下角有控制台（**8329** 端口，独立进程）：

| 按钮 | 作用 |
|---|---|
| ↩ 撤回上一步 | 用 `state.json.bak` 盖回去（**只能退一步**） |
| ⟳ 重启（拉最新代码） | 重新复制 js/server/页面，数据保留 |
| ↺ 回到开工 | 两条任务重置成「待接取 v0」，并清掉看板里的派活卡（`dp:` 开头的） |
| ↺ 回到启动时的真数据 | 恢复成启动那一刻拷过来的真实数据（可能已完成/已失败） |
| ＋ 造一条旧修订意见 | 给最后一条任务加一条 `relatedContentRevision = 当前-1` 的意见，用来验「旧修订不可确认」 |

- **8321 是集成测试固定端口，沙箱不许占用**（占过一次，集成测试直接红）。
- 关掉黑窗口 = 全部停止；同时只开一个沙箱窗口（撤回依赖"最近一次写盘"）。

## 8. 备份 / 恢复 / 回滚（2026-10-28 实测过一遍）

**现有两份导出，字段类型不一样，恢复时要注意：**

| 文件 | `taskCardData` 类型 | 说明 |
|---|---|---|
| `backup\taskcard-backup-20261024.json` | **字符串** | 原样写回 `localStorage['taskCardData']` 即可 |
| `backup\taskcard-localstorage-20261025-145456.json` | **对象** | 先 `JSON.stringify` 再写回 |

恢复步骤（F12 控制台）：

```js
const bak = await (await fetch('/backup/xxx.json')).json();   // 或手动打开文件复制内容
localStorage.setItem('taskCardData', typeof bak.taskCardData === 'string' ? bak.taskCardData : JSON.stringify(bak.taskCardData));
location.reload();
```

实测结果：两份都能恢复到 3 张原任务，`version:2 → 3` 自动迁移，之前塞进去的乱数据全部消失。

**程序被回滚（数据比程序新）**：页面顶部会出现橙色「只读保护」横幅，任务照常显示但任何改动都不保存。
解决办法：换回新版程序，或用上面的导出文件恢复。**注意：直接改 localStorage 是绕过程序的，拦不住——拦截点在 `saveData`。**

**服务端状态恢复（`dispatch-data/state.json` 损坏）**：服务启动时会自动从 `state.json.bak` 恢复，页面照常可用，
日志会打印「已从 state.json.bak 恢复」。**代价：丢最后一次写入**（实测 v8 → v7，那条反馈没了）。要零丢失得做多份快照，属 v2.0。

## 9. 常见故障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 双击 `start.bat` 黑窗口一闪 | 端口被别的程序占着 | 看提示；别杀 node，先确认 8317 是谁 |
| 页面改完没变化 | 浏览器缓存 | `Ctrl+F5` |
| 集成测试红、报端口 8321 被占用 | 沙箱或别的服务占了 8321 | 关掉沙箱窗口再跑测试 |
| today 里点了完成、看板没变 | 跨标签同步没生效（旧版） | 现已在 `render.js` 里监听 `storage`，强刷一次确认版本 |
| 看板显示"数据版本高于本程序" | 程序被回滚 | 换回新版程序，或用 `backup\` 恢复 |
