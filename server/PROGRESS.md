# PROGRESS —— 场2 进度流水（防断线用：只记进度，不写代码）

> 规则：每完成一个可验证的小步追加一行 `时间 | 做了什么 | 验证结果`。断线恢复时读本文件重建现场，不靠记忆。

## 回填（断线前，2026-10-25）

- 14:39 | 阶段1：Node 核验 v24.21.0；备份 start.bat / js-storage.js / DECISIONS 至 backup\*.bak-20261025 | 通过（cmp 逐一一致）
- 14:41 | 阶段2：main.mjs 骨架 + start.bat 换 Node + .gitignore + D-008 | 通过（13 项 curl）→ 已提交 7b89eb1
- 14:55 | 备份闸门：用户浏览器导出 taskcard-localstorage-20261025-145456.json | 通过（origin=127.0.0.1:8317 / v2 / 结构完整）
- 15:12 | 阶段3：schema.mjs / repository.mjs / publisher.mjs 写入（含 2 处断线前自查修复：新建任务时序、模块缓存） | 通过（单测 25/25）
- 15:12 | T-3 守卫：storage.js 上锁拒写 + app.js 只读横幅；app.js 备份 backup\app.js.bak-20261025 | 垫片单测通过；浏览器表现留场4 用户实测（用户已确认冻结两文件）
- 15:15 | main.mjs 接入 repo/publisher/token/POST 路由；readBody 超限改排水 | 拒绝路径实测过；成功路径因脚本 /tmp 路径 bug 未跑通（脚本问题，非服务缺陷）
- 16:0x | readBody 413 断线后补验 | 通过（413 可达、连接存活、紧随请求得 400）
- 16:0x | 断线恢复报告（五步）交用户 | 用户批准 + 三约束 + 时间盒 17:00

## 续跑（本节起实时追加）

- 16:1x | 建 PROGRESS.md 本文件；D-009（localStorage 维持 v2）入 DECISIONS；.gitignore 增 server/test/.tmp/ | 待提交
- 16:2x | main.mjs 加 /api/today 最小路由（约束二：空态 200+published:false；已发布给定义+执行快照）；复原一处误删换行 | 语法过；行为由集成测试断言
- 16:3x | 集成测试文件化（fetch 直连 8321，无 /tmp）：空态/令牌/预览/发布/重发/accept/重放/409/422/400/413/403/快照 | 通过（21/21）；单测回归 25/25
- 16:3x | 真实样例已发布进 dispatch-data（manifest+published/<gen>/definition.json+tasks.html）；测试执行状态已清理 | 通过
- 16:2x | reviewer 独立审查：结论「可继续」，6 条一般问题（1 bak覆盖顺序 / 2 集成测试删真实状态 / 3 日期耦合 / 4 疑似占位key / 5 内存幽灵 / 6 孤儿目录）；QA 复验抓到集成测试重跑不幂等（19/21） | 收到，进入修复
- 16:3x | 修复评审1/5：repository 恢复模式保护备份（坏主文件不再覆盖好备份）+ 非法迁移不建档；集成测试 fixture 化+date 归一为当天+已存状态备份还原+幂等断言（评审2/3 一并解决） | 单测 27/27（含新增 2 项）
- 16:3x | 评审4 经 grep 证实为脱敏显示误报：磁盘无 SECRET 字面量，实际为语义键，测试 6 处引用一致 | 已核实，不改
- 16:3x | 用户新规则：能 mv 不 rm。dispatch-data（首次发布 gen-2026-10-25-mvnk2r4a-3fb76e）整体移至 dispatch-data.history\1618-首次发布成功\ | 完成，证据保留
- 16:3x | 重跑验证：集成第 1 遍 21/21（空态断言+全新发布 gen-2026-10-25-mvnkpo5a-bf3c54）；第 2 遍 20 通过+1 SKIP（空态正确跳过）= 重跑幂等成立 | 通过
- 16:4x | .gitignore 增 dispatch-data.history/ | 待提交
- 16:4x | 决策留痕（评审待验证2）：schema 必填只卡 id/dispatchKey/title/minutes/date，why/steps/prompt 等可选、acceptance 缺失仅警告——理由：真实派活缺说明字段不应整批被拒 | 已定
- 16:4x | 推迟留痕（评审待验证3）：GET /api/dispatches/:key 的 definition 暂为 manifest 摘要，prompt/steps 原文待场3 阶段5（复制按钮需要时）扩展 | 已定
- 16:4x | reviewer 复核：repository 两项修复成立；新阻塞＝集成测试仍可删唯一 .bak、与 8317 共用真实目录 | 收到
- 16:46 | 集成测试改沙箱模式（复制 server/*.mjs 到 server/test/.tmp/sandbox-<pid>/ 启动，真实 dispatch-data 零读写 + 指纹断言）；评审1 单测改为 tmp 真实失败 + bak 版本断言 | 单测 27/27；集成连跑两遍各 24/24；8321 无残留
- 16:4x | 约束①口径：依据操作记录与 git diff 7b89eb1 未发现违约证据（无冻结时点快照，不称独立证实） | 已定
- 16:5x | reviewer 窄范围复核：沙箱隔离两处主体正确，新增阻塞＝8321 占用时未校验 pid 归属 | 收到
- 16:5x | integration.test.mjs 增 health.pid === child.pid 校验；不匹配提前 throw 阻止后续 POST | 通过（24/24）
- 16:49 | reviewer 最终结论「可继续」；修其低优先级提醒（子进程已退出时不再空等 exit） | 单测 27/27；集成 24/24；端口被占负向测试：ABORT + exit=1 + 真实数据指纹不变 + 无挂起
- 16:5x | 场2 收尾报告交用户，停下等 commit | —
