# WorkBuddy → CodeBuddy 跨工具调用：可行性、前提、实现路径与替代方案

> 调研日期：2026-10-06　　目标形态：在 WorkBuddy 里输入提示词，直接命令 CodeBuddy 执行编程任务

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 可行吗？ | **可行**，但不是"开箱即用"的官方功能，需要自建一层"胶水" |
| 为什么会可行？ | WorkBuddy 与 CodeBuddy **同源**（同一套 CLI 引擎 `codebuddy` / 同一套 hooks 生命周期与配置范式）；CodeBuddy 对外暴露了标准的**「智能体服务端」接口** |
| 有官方现成方案吗？ | ❌ 没有 "CodeBuddy MCP Server"，也没有现成的 WorkBuddy→CodeBuddy 连接器 |
| 推荐路径 | **路径 B（MCP 胶水）** 落地最快；**路径 A（ACP）** 最标准、最长期；**路径 D（文件任务卡）** 最稳、零协议依赖 |
| 本机离跑通还差什么 | 只差一步：**安装并登录 `codebuddy` CLI**（其余前提本机已具备） |

---

## 1. 本机环境实测（前置事实）

| 检查项 | 实测结果 |
|---|---|
| WorkBuddy 桌面端 | ✅ 已安装：`D:\Program Files\WorkBuddy\WorkBuddy.exe`，版本 `5.6.2` |
| WorkBuddy 配置目录 | ✅ `~/.workbuddy/`（`settings.json`、`mcp-tool-list.json`、`connectors/`、`skills/`、`tasks/`、`sessions/`、`plans/`、`audit-log/`、`workbuddy.db`） |
| WorkBuddy 托管运行时 | ✅ `~/.workbuddy/binaries/` 下已有 `node`、`python`、`PortableGit` —— 即官方文档所述的 **runtime 托管**能力（用户无需预装 Node/Python） |
| WorkBuddy 权限模型 | ✅ `settings.json` 中有 `sandbox.orderedRules`，按 `file` / `command` / `network` 三类，逐路径/逐命令配置 `allow / ask / deny` |
| WorkBuddy 远程驱动通道 | ✅ `settings.json` 中已启用 `claw.channels`（`wechatmp`、`weixinClawBot`），即微信 ClawBot 接入 |
| Node / npm | ✅ Node `v24.21.0`、npm `11.19.0`（满足 Node 18+ 要求） |
| **CodeBuddy CLI** | ❌ **未安装**：`where codebuddy` / `where cbc` 均无输出 |
| CodeBuddy MCP 配置 | `~/.codebuddy/mcp.json` 当前为空（`{"mcpServers":{}}`） |

> **结论**：WorkBuddy 侧的前提条件（进程调度、运行时、权限、网络）已经齐备，缺的只有 CodeBuddy CLI 本身。

---

## 2. 为什么可行——五条关键事实

### 事实 1：两者同源，不是两套异构系统

WorkBuddy 与 CodeBuddy 属于同一产品家族（腾讯云代码助手），**共用同一套 CLI 引擎与配置范式**：

- CLI 二进制同名 `codebuddy`（别名 `cbc`），npm 包 `@tencent-ai/codebuddy-code`；WorkBuddy 官方 CLI 文档的示例命令里写的也是 `codebuddy ...`
- Hooks 生命周期事件同构（`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop` 等），配置格式与 Claude Code 一致
- 用户级配置分别是 `~/.workbuddy/settings.json` 与 `~/.codebuddy/settings.json`，字段结构同族

> 含义：跨工具调用的**语义鸿沟很小**，不需要做概念映射，主要工作是"把进程拉起来 + 把结果传回去"。

### 事实 2：CodeBuddy 官方对外暴露了标准「智能体服务端」接口

官方为 CodeBuddy Code 提供了两种 IDE 集成方式，其中第一种是**被外部调用的标准协议**：

| 集成方式 | 说明 | 对跨工具调用的意义 |
|---|---|---|
| **ACP（Agent Client Protocol）** | `codebuddy --acp`，作为**通用「智能体服务端」被 IDE 调用** | ⭐ 唯一的**官方标准协议**接口：JSON-RPC over stdio，支持创建会话、发送提示、流式接收消息、查看工具执行进度、协议内处理权限请求 |
| `--ide` 伴生进程 | 配合 `/ide` 斜杠命令，作为 IDE 插件后端 | 面向 IDE 插件，不适合第三方程序调用 |

> ACP 由 Zed 发起，类比"agent 界的 LSP"，生态已有 40+ agent 与多家编辑器支持。

### 事实 3：CodeBuddy CLI 支持完整的非交互（headless）模式

```bash
codebuddy -p "把 src/ 下的日志统一改成结构化输出"          # 单次执行后退出
cat error.log | codebuddy -p "分析这些错误日志"             # 管道输入
codebuddy -p "..." --output-format json                    # 结构化输出，便于程序解析
codebuddy -p "..." --output-format stream-json             # 流式输出
codebuddy -c                                               # 继续最近会话
codebuddy -r <sessionId>                                   # 恢复指定会话
codebuddy --model gpt-5 --fallback-model gpt-4 -p "..."    # 模型与回退
```

权限与范围控制参数（非交互模式的**关键**）：

| 参数 | 作用 |
|---|---|
| `--permission-mode <default\|acceptEdits\|bypassPermissions\|plan>` | 会话级权限模式 |
| `--dangerously-skip-permissions` | 绕过全部权限检查（非交互下操作文件/网络**需要**它，或等价的模式配置） |
| `--allowedTools` / `--disallowedTools` | 白/黑名单工具，如 `"Bash(git:*) Edit"` |
| `--add-dir <dir...>` | 允许访问的额外目录（收敛作用范围） |
| `--mcp-config <fileOrString>` / `--strict-mcp-config` | 给被调起的 CodeBuddy 注入 MCP 配置 |

> 含义：**CodeBuddy 可以被当作一个纯命令行工具来脚本化调用**，输入 prompt、输出 JSON/流。

### 事实 4：WorkBuddy 官方扩展接口明确支持"调度本地 CLI"

WorkBuddy 的官方能力扩展机制 **Connector** 提供两种集成方式，两者只能二选一：

| 方式 | 适用场景 | 机制 |
|---|---|---|
| **MCP + Skill**（推荐） | 已有 API 服务，或可自建 MCP Server | 通过 MCP 协议暴露工具；本地进程可用 **stdio**（即 `command` + `args`） |
| **CLI + Skill** | **已有成熟的命令行工具** | **WorkBuddy 负责安装与调度 CLI**，CLI 自行管理登录态与凭证 |

CLI 方式的硬性约束（摘录，直接影响你的设计）：

- 必须提供非交互式安装路径，以及明确的 `auth` / `status` / `unAuth` 命令
- `status` 必须**幂等、只读、无副作用**
- 不得依赖用户预装的 Node/Python；如需运行时须在 `cli.json` 声明 `runtime`，由 WorkBuddy 托管（本机已见 `binaries/node`、`binaries/python`）
- 凭证必须与 CLI 安装目录分离，不得硬编码
- Windows 平台命令需使用 `.cmd` 后缀
- `auth` 命令 **10 秒超时**且进程会被立即终止；`status` 10 秒；`init` 5 分钟；`unAuth` 30 秒
- 一个 Connector **只能配置一个 MCP Server**，且不得同时用两种方式

> 含义：即使不写自己的胶水，WorkBuddy 也**原生支持**"让一个本地 CLI 成为我的能力"。

### 事实 5：社区已有双向成功先例

| 项目 | 方向 | 做法 | 启示 |
|---|---|---|---|
| `workbuddy-mcp` | 其他 Agent → WorkBuddy | 一个极轻量 stdio MCP Server，内部 `spawn codebuddy -p "<prompt>" --dangerously-skip-permissions`，对外只暴露一个工具 `run_workbuddy_task(prompt, cwd, model, json)`；支持一键注册到 Claude Code / Codex / Cursor / OpenCode | ⭐ **这正是你需要的胶水范式**，把 `WB_COMMAND` 指向 `codebuddy` CLI 即可复用于你的方向 |
| `Kimi Bridge` | WorkBuddy → 本地 kimi-code CLI | gRPC 核心 + HTTP API + MCP 适配的三层架构，MCP 原生接入、事件流驱动 | 证明了 **WorkBuddy 通过 MCP 调本地编程 CLI** 完全走得通 |
| ACP 生态 | 编辑器 → 任意 Agent | `codebuddy --acp` 已被视为可复用的 ACP agent | 走标准协议比自造轮子更抗变更 |

---

## 3. 前提条件清单（逐项可核验）

| # | 前提 | 说明 | 本机状态 |
|---|---|---|---|
| 1 | **安装 CodeBuddy CLI** | `npm install -g @tencent-ai/codebuddy-code`，验证 `codebuddy --version` | ❌ 待做 |
| 2 | **完成一次交互式登录** | 先跑 `codebuddy` 走完登录（凭证持久化到本地）；非交互模式依赖这份凭证 | ❌ 待做 |
| 3 | **PATH 可达或写绝对路径** | Windows 下二进制为 `.cmd`；找不到时在配置里写绝对路径 | 装机后确认 |
| 4 | **解决权限放行** | 非交互下文件写入/网络访问默认被拦，必须给 `--permission-mode` / `--allowedTools` / `--add-dir` / `--dangerously-skip-permissions` 之一 | 需配置 |
| 5 | **明确工作目录（cwd）** | 否则 `-p` 产生的文件会落在不确定位置；MCP 调用建议每次显式传 `cwd` | 需约定 |
| 6 | **WorkBuddy 侧有"起进程"的通道** | 内置命令执行（受 `sandbox.orderedRules.command` 管控）、或 MCP stdio server、或 CLI 型 Connector | ✅ 具备 |
| 7 | **运行时** | Node 18+（MCP 胶水）；WorkBuddy 也可托管 node/python | ✅ Node 24 / npm 11 |
| 8 | **网络可达** | 任务真实执行需要联网，**不能离线**（MCP Server 本地，但 CLI 会连服务端） | ✅ |
| 9 | **异步化设计** | 编程任务常 > 30s；MCP Connector 规范要求**单请求 30 秒内响应**，长任务必须改为异步 + 轮询/流式 | 需设计 |
| 10 | **仓库写入互斥** | 两个 agent 同时改同一仓库会冲突，需串行队列 / 锁 / 独立 worktree | 需设计 |

---

## 4. 五条可行实现路径

### 路径 A — ACP 协议对接（最标准，长期最稳）⭐

```
WorkBuddy（ACP Client 角色）
      │  stdio / JSON-RPC (ACP)
      ▼
codebuddy --acp   ← 官方定位："通用智能体服务端"
      │
      ▼
在你的仓库里读写代码、跑测试，流式回传工具执行进度
```

- **优点**：官方协议，能力最全——原生支持会话管理、流式消息、工具执行进度、**协议内权限请求**（不必用 `--dangerously-skip-permissions` 这种粗暴开关）；不受 CLI 参数变更影响。
- **前提**：WorkBuddy 需能作为 ACP Client 拉起进程。**官方目前未说明 WorkBuddy 是 ACP Client**，因此这条路要么等官方支持，要么自写一个薄 ACP 客户端（或把 ACP 再包一层 MCP 给 WorkBuddy）。
- **适用**：把 CodeBuddy 接入 Zed / JetBrains 等已支持 ACP 的宿主；或你愿意做长期工程投入。

### 路径 B — MCP 胶水（最省事，社区已验证）⭐⭐ 推荐首选

```
WorkBuddy  ──MCP(stdio)──▶  你/社区的 MCP Server
                                    │  spawn
                                    ▼
              codebuddy -p "<prompt>" --output-format json \
                        --dangerously-skip-permissions --add-dir <repo>
                                    │
                                    ▼
                        结果 JSON → WorkBuddy 上下文
```

- **做法**：复用 `workbuddy-mcp` 的思路（或直接用它，把 `WB_COMMAND` 指向 `codebuddy` CLI），暴露一个工具：

```js
// Tool: run_codebuddy_task(prompt, cwd?, model?, json?)
// 内部等价于：
//   spawn(WB_COMMAND, ['-p', prompt, '--output-format', 'json',
//                      '--dangerously-skip-permissions', '--add-dir', cwd], { cwd })
```

- **注册到 WorkBuddy**：写入 `~/.workbuddy/settings.json` 的 `mcpServers`（或 `~/.workbuddy/mcp.json`）：

```json
{
  "mcpServers": {
    "codebuddy": {
      "command": "node",
      "args": ["C:/Users/10561/tools/codebuddy-mcp/server.js"],
      "env": {
        "WB_COMMAND": "codebuddy",
        "WB_SKIP_PERMISSIONS": "false",
        "WB_TIMEOUT": "600000",
        "WB_CWD": "C:/path/to/default/repo"
      }
    }
  }
}
```

- **注意**：`WB_SKIP_PERMISSIONS: false` 会保留人工确认（更安全但需人守着）；`true` 则无人值守全自动，**任何操作都会被执行**。
- **适用**：想尽快跑通、且接受自维护一个 ~200 行的小 server。

### 路径 C — 官方 Connector（CLI + Skill，正规分发）

```
your-codebuddy-connector/
├── connector-meta.json   # type: "cli"，source 为 kebab-case 全局唯一
├── cli.json              # 安装/认证/状态/登出配置 + runtime
├── icon.svg
└── skills/codebuddy-runner/SKILL.md
```

- **优点**：WorkBuddy 负责安装、授权、状态检查、升级；可上架 Connector Marketplace 分发给团队；符合官方规范。
- **硬性约束**：一个 Connector **只能选 MCP 或 CLI 之一**；`auth` 命令 10s 超时且进程会被立即终止（不能自己等 OAuth 回调，推荐 Device Code Flow）；`status` 必须幂等只读；凭证须跨重启存活；Windows 需 `.cmd`。
- **适用**：要长期用、要分享给同事、愿意走一次审核。

### 路径 D — 文件任务卡 + Hooks（最低耦合，最稳）⭐ 建议先做

```
WorkBuddy  ──写──▶  shared/tasks/taskcard-<ts>.md
                            │  （你制定的任务卡协议）
                            ▼
        CodeBuddy 侧 Hook / 定时任务 / 手动 / 斜杠命令 领取执行
                            │
                            ▼
                    shared/tasks/result-<ts>.md
                            │  读回
                            ▼
                      WorkBuddy 汇报结果
```

- **做法**：约定一个目录（例如 `c:\Users\10561\Desktop\Task Card\`），WorkBuddy 按固定模板写任务卡（目标 / 验收标准 / 涉及文件 / 约束 / 输出路径），CodeBuddy 侧用 Hook（`SessionStart` 或自定义事件）、终端循环脚本、或你手动一句"读任务卡并执行"来领取；执行完回写结果 + `handoff-*.md`。
- **优点**：零协议依赖、零额外进程、可审计（天然留痕）、容错最好；与你的 `Task Card` 工作区命名天然契合。
- **缺点**：非实时（有轮询/人工延迟）；上下文需显式传递。
- **适用**：**推荐作为第一步验证**，也适合作为长期兜底通道。

### 路径 E — WorkBuddy Skill 直接调 CLI（最轻，半自动）

在 WorkBuddy 的 skill 目录（`~/.workbuddy/skills/`）放一个 Skill，用 Markdown 指令引导 Agent 在需要编程时调用：

```markdown
---
name: delegate-to-codebuddy
description: 当任务涉及写/改代码、跑测试、仓库操作时，转交 CodeBuddy CLI 执行
---

## 何时使用
需要真实修改代码库、运行构建或测试时。

## 怎么调用
在目标仓库目录下执行（Windows 使用 codebuddy.cmd）：

    codebuddy -p "<完整任务提示词>" --output-format json --add-dir <repo>

- 提示词必须自包含：背景、目标、验收标准、涉及文件、禁止事项
- 执行完成后，读取落盘文件确认结果，再向用户汇报
- 长任务加超时保护，失败时把 stderr 一并回传
```

- **优点**：10 分钟就能试；不需要写代码。
- **缺点**：依赖 WorkBuddy 的命令执行被你放行，且受其 `sandbox.orderedRules.command` 管控；属于"Agent 自觉调用"，稳定性不如前几种。

### 路径对比

| 路径 | 落地成本 | 实时性 | 稳定性 | 权限安全 | 适合阶段 |
|---|---|---|---|---|---|
| A · ACP | 高 | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ 协议内审批 | 长期 / 标准化 |
| B · MCP 胶水 | 中 | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ 可控 | **正式化首选** |
| C · Connector | 中高 | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 分发 / 团队 |
| D · 文件任务卡 | **低** | ⭐ | ⭐⭐⭐ | ⭐⭐⭐ | **验证首选 / 兜底** |
| E · Skill 直调 | **最低** | ⭐⭐ | ⭐⭐ | ⭐ | 试用 |

---

## 5. 限制、坑与风险

### 5.1 能力边界

1. **没有官方"反向 MCP"**：CodeBuddy 没有 MCP Server 模式（`codebuddy mcp add/list/remove` 是它作为 **Client 去连别人**的 MCP），所以"让 WorkBuddy 把 CodeBuddy 当 MCP 工具调"必须你自己写胶水。
2. **没有现成连接器**：Connector Marketplace 里没有 CodeBuddy 连接器。
3. **一个 Connector 只能一种方式**：MCP 与 CLI 不可混用；若同一服务要支持 OAuth 与 token 两种鉴权，必须提交为**两个独立 Connector**。
4. **插件代理能力受限**：出于安全，插件代理**不支持** `hooks`、`mcpServers`、`permissionMode` 字段。

### 5.2 上下文与会话

5. **上下文不共享**：两者虽同源，但跨工具调用本质是**新会话**。WorkBuddy 的对话记忆不会进入 CodeBuddy，反之亦然 —— 必须靠**自包含的提示词或交接文档**显式传递（可参照 `handoff` 模式：当前状态 / 下一步 / 相关产物 / 建议加载的技能）。
6. **产物不自动回流**：CodeBuddy 写的文件落在其 `cwd`，**不会自动进入** WorkBuddy 的上下文，必须显式读回。
7. **会话可见性**：CLI 以独立会话运行，其对话**可能不出现在 WorkBuddy 桌面端历史**中，排障时要注意去看 `~/.workbuddy/logs/`、`~/.workbuddy/audit-log/` 与 CodeBuddy 侧 `~/.codebuddy/logs/`。
8. **多轮衔接**：需要连续对话时用 `-c` / `-r <sessionId>` / `--session-id <uuid>`，并自己维护 session 映射（并发多任务时不能共用 `-c`）。

### 5.3 权限与安全（最需要注意的一块）

9. **`--dangerously-skip-permissions` 是真·危险**：它绕过**全部**权限检查，Agent 请求的任何文件写入与网络访问都会自动执行。官方建议仅用于无网络沙箱；社区项目也默认把 `WB_SKIP_PERMISSIONS` 设为 `true` 并明确提示风险。
10. **最小权限收敛**：用 `--add-dir` 限定仓库、`--allowedTools "Bash(git:*) Edit Read"` 限工具、`--permission-mode acceptEdits` 折中；WorkBuddy 侧同理由 `sandbox.orderedRules` 的 `file` / `command` / `network` 规则约束（本机当前 `command.rules` 与 `network.rules` 均为空）。
11. **工作区外写入风险**：`extraAllowWrite` 已列出 `~/.ssh/`（ask）、`~/.aws/`（读 allow / 写 ask）等敏感目录 —— 联调时务必确认 CodeBuddy 的 cwd 与 `--add-dir` 不越界。
12. **凭证分离**：任何胶水的配置文件里**不得**出现真实 token；MCP/Connector 配置用 `${VAR_NAME}` 占位引用。

### 5.4 工程与运维

13. **超时**：MCP Connector 规范要求单请求 **30 秒内**响应；Connector 的 `auth` 10s、`status` 10s、`init` 5min、`unAuth` 30s。长编程任务必须**异步化**（提交 → 轮询进度 → 取结果），或改用流式输出。
14. **并发写冲突**：两个 Agent 同时改同一仓库必然冲突。需要串行队列、目录级锁，或为每个任务开独立 worktree。
15. **成本与配额**：两边都消耗 token，双向调用会放大开销；必须设超时（如 10 分钟）、并发上限与失败熔断。
16. **离线不可用**：MCP Server 是本地进程，但 `codebuddy` 调用需联网，无法离线执行。
17. **平台差异**：CLI 至少需支持 macOS/Linux，Windows 需 `.cmd`（如 `codebuddy.cmd`）；推荐同时覆盖三平台。
18. **版本漂移**：CLI 参数与文档常有滞后（官方 CLI 参考自称"部分命令为预留占位，以 `--help` 实际输出为准"），胶水代码要**以 `codebuddy --help` 实测为准**，不要照抄博客。
19. **同源带来的"自欺"**：既然两者同一引擎，若你只是想自动化，用**单个工具 + Subagent + Hooks** 往往比跨工具胶水更省事（见下节）。

---

## 6. 替代方案

| 方案 | 做法 | 适用 |
|---|---|---|
| **反向编排**（现成可用） | 用 `workbuddy-mcp` 让 **CodeBuddy 驱动 WorkBuddy**，把"编排"放在 CodeBuddy 侧 —— 你本来就更看重 CodeBuddy 的 agent 界面，这条路**今天就能跑** | 想立刻见效、且不介意方向反过来的 |
| **单工具替代文档任务** | 你当前 CodeBuddy 已启用 `docx` / `pdf` / `xlsx` / `pptx` / `agent-browser` / `find-skills` 插件；文献整理、提示词撰写、文档产出完全可在 CodeBuddy 内用 Ask/Plan 模式 + Skills 完成 | 不想维护两套工具链的 |
| **第三方编排层** | n8n / 定时任务 / 消息队列 / 自写 orchestrator 作为中立调度者，两边都只当"执行器" | 任务量大、需要集中可观测性 |
| **ACP 宿主统一** | 用 Zed / JetBrains 等支持 ACP 的编辑器作为唯一宿主，把 CodeBuddy 作为 ACP agent 接入，办公任务在 WorkBuddy 完成后再落地 | 想要标准化、不愿写胶水 |
| **消息通道远程驱动** | 你本机 WorkBuddy 已启用微信 ClawBot 通道（`weixinClawBot` / `wechatmp`），可用 IM 消息远程给 WorkBuddy 下指令，再由它转发 CodeBuddy | 需要"手机上指挥电脑干活" |
| **零集成** | 人工复制粘贴提示词 + `handoff` 文档 | 低频任务，最省工程成本 |

---

## 7. 建议落地路线

| 阶段 | 动作 | 产出 | 预计成本 |
|---|---|---|---|
| **0. 补齐前提** | `npm install -g @tencent-ai/codebuddy-code` → 交互式 `codebuddy` 登录一次 → `codebuddy --version` 验证 | CLI 可用 | 10 分钟 |
| **1. 冒烟验证** | 手动执行 `codebuddy -p "在此仓库新建 hello.txt" --output-format json --add-dir .`，确认能落盘、能拿 JSON | 验证前提与权限参数组合 | 15 分钟 |
| **2. 最低耦合先跑通**（路径 D/E） | 在 WorkBuddy 放一个 Skill 或约定任务卡目录，跑通"WorkBuddy 出提示词 → CodeBuddy 执行 → 结果回读" | 端到端闭环 | 半天 |
| **3. 正式化**（路径 B） | 写/复用 stdio MCP Server 暴露 `run_codebuddy_task`，注册到 `~/.workbuddy/settings.json`，加 cwd / 超时 / 权限环境变量 | 稳定可复用的调用通道 | 1–2 天 |
| **4. 工程加固** | 串行队列防并发冲突、异步 + 轮询解决 30s 超时、`--allowedTools` + `--add-dir` 收敛权限、日志与审计 | 可长期运行 | 2–3 天 |
| **5. 标准化/分发**（路径 C 或 A） | 打包为 CLI 型 Connector 上架；或投入 ACP 客户端实现 | 团队级能力 | 视需求 |

**核心建议**：先用 **路径 D/E** 半天内验证闭环，确认"提示词质量 + 结果回读"的体验符合预期后，再投入 **路径 B** 做工程化。**不要一上来就做 ACP/Connector** —— 很容易在协议层花掉一周却还没验证最关键的"学习助手写的提示词，编程 Agent 到底执行得好不好"。

---

## 8. 参考来源

- 官方文档：CodeBuddy IDE 概览 / CLI 入口（`codebuddy.ai/docs/zh/ide/User-guide/Overview`）
- 官方文档：WorkBuddy Connector 开放平台指南（`open.workbuddy.cn/en/docs/connector`）—— 两种集成方式、`cli.json` 字段、认证与超时约束
- 官方文档：WorkBuddy Enterprise IDE 集成（`cloud.tencent.com/document/product/1831/137019`）—— **ACP 协议集成 + `--ide` 伴生进程两种方式**
- 官方文档：WorkBuddy Enterprise Hooks / 插件 API 参考（`cloud.tencent.com/document/product/1831/137022`、`/137036`）—— hooks 事件、插件代理限制
- 第三方整理：CodeBuddy CLI 参考（`w3cschool.cn/codebuddydocs/codebuddy-cli-reference.html`）—— 全局选项、权限参数、输出格式
- 社区项目：`workbuddy-mcp`（LobeHub MCP 目录，作者 LinHaiJ）—— 反向 MCP 胶水的完整范式与 `WB_*` 环境变量
- 社区项目：WorkBuddy Kimi Bridge（HiMCP）—— WorkBuddy 经 MCP 调用本地编程 CLI 的三层架构先例
- 本机实测：`~/.workbuddy/`（`settings.json`、`mcp-tool-list.json`、`connectors/`、`binaries/`）、`~/.codebuddy/`（`settings.json`、`mcp.json`）、`where codebuddy`
