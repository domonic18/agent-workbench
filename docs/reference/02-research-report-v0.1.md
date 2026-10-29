> **来源**：飞书文档《【项目】智能体工作台 · 调研报告 · 开源方案 · v0.1》 <https://my.feishu.cn/docx/DBtudhcgjo4oRKxmiXec14Qunlf>
> **落档**：2026-10-29（原文导出，仅将飞书原生表格/引用转为 Markdown，正文未改写）
> **定位**：外部参考资料，非项目内需求基线；项目需求基线见 [../requirement/01-requirement.md](../requirement/01-requirement.md)。

# 【项目】智能体工作台 · 调研报告 · 开源方案 · v0.1
> 调研时间：2026-10-29 ｜ 承办：随行-小W
> 方法：GitHub API 筛选 → 四仓库浅克隆到本地 → 读架构文档与关键源码 → 提取可复用设计
> 本地代码：`~/Code/ai_proj_working/agent-workbench-refs/`（happyclaw / CowAgent / PilotDeck / paperclip）
---
## 一、调研方法
1. 用 GitHub API 按四组关键词检索（agent workstation / agent harness / agent os / 多智能体协作），按星数排序取头部项目
1. 剔除三类：纯框架（LangChain 类）、纯模型侧、无许可证不可读的
1. 对留下的 10 个做「四件事」映射，挑出四个真正做过完整工程的仓库浅克隆
1. 读它们的**架构文档与源码**，不做功能罗列，只提取可迁移的设计
样本规模：
| 项目 | 星 | 许可 | 技术栈 | 规模 |
|---|---|---|---|---|
| riba2534/happyclaw | 844 | MIT | TypeScript / Node ≥20 | 1559 个 ts/tsx，649 个测试文件，15 个渠道适配 |
| zhayujie/CowAgent | 47.6k | MIT | Python ≥3.7 | 1007 个 py，13 个渠道目录，629 个测试 |
| OpenBMB/PilotDeck | 4.9k | AGPL-3.0 | TypeScript / Electron | 5 个应用包，32 个内置 skill |
| paperclipai/paperclip | 108k | MIT | TypeScript | 编排层 + React 控制台 |
---
## 二、四个项目读到的东西
### 2.1 HappyClaw —— 与我们同源，但是「工程化完成版」
它做的事几乎就是 cc-connect 想做的事：把 Claude Code 变成一个多用户、多渠道、能长期跑的服务。差别在于它把每一个我们靠人肉兜住的环节都写成了代码。
**架构形态：模块化单体 + 隔离运行时**（`docs/RUNTIME-ARCHITECTURE.md`）
- 一个控制面进程拥有 HTTP、调度、持久状态、渠道路由，共享一个 SQLite 事务域
- Agent 执行放在独立的 Host 进程或 Docker 容器里，由 supervisor 监管
- 渠道路由到「精确的那个账号实例」（`src/im-manager.ts`），而不是「某个渠道」
- 渠道 SDK 懒加载：不启用就不加载，避免启动即初始化 8 个平台
**它解决的正是我们的三个痛点**
| 我们的问题 | 它的机制 | 代码位置 |
|---|---|---|
| 两个 Agent 抢同一个会话的事件 | 每个会话一个串行队列，durable cursor 存在 SQLite | `src/group-queue.ts` |
| 消息发出去不知道有没有到 | 发件箱模式：enqueue → claim → sending → uploaded → complete/fail，另有「状态不明」的核对与过期回收 | `src/channel-outbox-delivery.ts`、`channel-reliability-store.ts` |
| Agent 卡死没人知道 | 卡死检测、Runner 恢复、IPC 投递恢复 | `src/stuck-runner-recovery.ts`、`ipc-delivery-recovery.ts` |
| 消息乱序 / 重复 | 游标同时带时间戳与自增序号，双序比较 | `src/delivery-cursor.ts` |
**权限模型（**`**docs/ACL-MATRIX.md**`**，400 行）——最值得抄的一份**
- 十二层权限：Public / Login / Access / Modify / Delete / Host / System / Users / Invites / Audit / Billing / IM Owner，每层对应一个明确的中间件入口
- 核心原则第一条：**admin 不自动绕过工作区所有权**
- Host 是额外边界：有工作区权限 ≠ 能执行 Host 操作
- 查不到与无权访问统一返回 404，避免跨用户枚举
- **Agent 侧的 MCP 调用没有 Cookie，必须携带主进程签发的运行上下文（ownerUserId、workspace/session 身份、IPC 目录、当前 turn 上下文、能力清单）；跨工作区操作必须经主进程校验，不允许 Agent 用文本参数自行扩大范围**
- 改 ACL 必须补八类测试（owner 通过、非 owner 拒绝、admin 是否绕过、Host/Container 分支、不存在与跨用户、多账号不串用、四端一致、失败路径不留半写状态）
### 2.2 CowAgent —— 渠道与知识做得最实
**渠道抽象支持「多实例绑定」**（`channel/channel.py`）
每个渠道实例带三个可选字段：`instance_id`、`bound_agent_id`、per-instance 凭据。为空时退化回全局配置，保持向后兼容。
这一点直接回答了我们的问题：**一个飞书应用只能对一个 Agent，是因为我们没做「实例」这一层**；有了 instance + bound_agent，同一个平台可以挂多个 Agent，各用各的凭据，各跑各的路由。
**知识是「文件为真相源 + 索引为派生」**（`agent/knowledge/service.py`）
- 目录里 `index.md`、`log.md` 是受保护文件，Agent 不能改写
- 索引行用 `链接 — 摘要` 的固定格式，链接做百分号编码
- 每个知识根一个重索引队列，**进程内带锁**，避免两个请求同时重建同一个索引
- 写入可以选择「文件落盘即返回，后台重建索引」，因为调用方不需要等索引
这套设计的价值：知识是**人能直接读、能进 Git 的 Markdown**，向量索引只是加速层，坏了可以重建。比「一堆向量」可维护得多。
**工具调用是参数级策略**（`agent/permission/policy.py`）
作者自己在注释里写明：这是参数级检查，不是 OS 沙箱。它做的事：
- 全局模式（只读 / 工作区写 / 放开）
- 命令分段解析，处理 `&&`、`|`、`;`、重定向、进程替换
- 路径归一化后判断是否在允许根内、是否命中受保护路径
- 危险动作正则（send / execute / install / approve / merge / grant 等）
对于我们「L2 高危要拦」这件事，这是一个现成的参考实现骨架。
### 2.3 PilotDeck —— 把「长期跑」当头等问题
**会话时间线契约**（`docs/architecture/session-timeline.md`）
它定义了一套显式的流式协议：`timeline = { version, turnId, id, previousId?, order, revision, offset?, streamBoundary? }`，解决的是「实时看板和落盘记录对不上」这一类问题——旧快照不能覆盖新内容，缺块要能发现，增量文本要能拼回原位，延迟到达的结束帧不能关掉后来的回答。
这正好是运行态看板的数据基础：**看板不是「再查一次」，而是订阅一条有版本的时间线**。
**三个产品级取向**
- WorkSpace 为单位的完全隔离（文件、记忆、技能），并行项目互不污染
- 白盒记忆：记错了能定位到具体条目并直接改
- 智能路由 + 按任务记账：琐事不用旗舰模型，后台跑得起
### 2.4 Paperclip —— 管理层的抽象
一句话定位：**「如果 OpenClaw 是员工，Paperclip 就是公司」**。表面是任务管理器，底下是组织图、预算、治理、目标对齐、Agent 协同；每个 Agent 可选不同模型与 harness，任务/技能/权限/历史集中一处。
读完源码后，它的记账与审批做得比 README 说的更具体：
- **成本靠心跳上报**：Agent 每次心跳带一条成本事件（provider、model、输入 tokens、输出 tokens、金额以美分为单位），按 Agent 按月聚合，公司级与 Agent 级各有一层预算
- **超限自动暂停**：不是提醒，是 auto-pause——超预算的 Agent 直接停摆，等人来调
- **审批是有类型的**：招聘 Agent、战略变更这类动作必须走审批流；「董事会」（人类）拥有 override 权
- 审批与预算都有对应的作用域测试（`budget-enforcement-scoping.test.ts`、`approvals-service.test.ts`），说明这两件事在他们的设计里属于「必须可验证」的部分
对我们的直接启发：黑板现在只是「任务表」，缺的是「编制」——谁负责、预算多少、对齐哪个目标、超了自动停。
---
## 三、可复用设计清单（按我们的四个目标编排）
| 编号 | 设计 | 出处 | 许可 | 去向 |
|---|---|---|---|---|
| R1 | 单控制面 + 隔离运行时 + 渠道路由到具体实例 | happyclaw | MIT | 架构基线 |
| R2 | 会话串行队列 + 持久游标 | happyclaw `group-queue.ts` | MIT | O1 |
| R3 | 发件箱投递状态机（含状态不明核对与过期回收） | happyclaw | MIT | O1 |
| R4 | 双序游标（时间戳 + 自增序号） | happyclaw `delivery-cursor.ts` | MIT | O1 |
| R5 | 十二层权限 + admin 不自动绕过 + 404 统一 | happyclaw `ACL-MATRIX.md` | MIT | O2 |
| R6 | Agent 身份由宿主注入，禁止文本参数提权 | happyclaw §10 | MIT | O2 |
| R7 | 卡死检测与恢复 | happyclaw | MIT | O1 |
| R8 | 渠道多实例 + 绑定 Agent + 独立凭据 | CowAgent `channel.py` | MIT | 后续扩展 |
| R9 | 知识以 Markdown 为真相源 + 后台重建索引 | CowAgent `knowledge/service.py` | MIT | O3 |
| R10 | 工具调用参数级策略（命令分段/重定向/受保护路径） | CowAgent `permission/policy.py` | MIT | O2 |
| R11 | 版本化会话时间线（order/revision/offset/边界） | PilotDeck | **AGPL** | O1（只借思想，不抄代码） |
| R12 | 组织抽象：编制、预算、目标对齐 | Paperclip | MIT | O4 |
**许可红线**：PilotDeck 是 AGPL-3.0，其代码一行都不能进我们仓库；只能读它的文档、理解它的做法，然后自己实现。其余 MIT 项目可以借鉴代码，但引用处仍要注明来源。
---
## 四、四个目标与设计方案的对应
**O1 运行态可见**
不是「做个看板页面」，而是先有可靠的状态流：会话串行（R2）→ 事件按 turn 落库（R11 思想）→ 投递有状态（R3/R4）→ 卡死能被发现（R7）。看板只是这条链的末端显示；链不成立，看板就是假象。
**O2 权限代码化**
三层：权限分层（R5）解决「谁能做什么」；身份注入（R6）解决「Agent 说自己是谁不算数」；调用策略（R10）解决「这一次调用该不该放行」。我们现有的 L0/L1/L2 正好落在第三层，缺失的是前两层。
**O3 知识可检索**
不做「向量库 + 上传文件」那种一次性工程，照 R9：Markdown 为真相源、Git 可版本化、索引可重建、写入即返回后台重建。语料就是我们已有的规范、复盘、踩坑。
**O4 成本可计量**
照 R12 把「编制」这一层补上：每个 Agent 有预算上限，每次任务记账，超限即停。
---
## 五、选型结论
**不引入任何项目做底座，只借鉴设计。**
理由三条：
1. 我们真正的资产是协作契约、黑板数据和规范，不是 cc-connect 的胶水代码；换底座等于把这些重新长一遍
1. HappyClaw 是 MIT 的完整实现，如果我们最终要走「多用户 + 沙箱」的路，它是最省的选择——但那是一个更大的决定，不该在补缺口阶段做
1. 引入 AGPL 项目（PilotDeck）会污染仓库许可；引入 MIT 项目也要背上别人的发布节奏
**但要跑一次 HappyClaw。** 不是为了用它，是为了对照：把我们靠人肉兜的环节和它的代码逐条对齐，能验证我们缺的确实是那几处，而不是自我想象。
---
## 六、对需求文档的输入
| 需求编号 | 来源 | 内容 |
|---|---|---|
| FR-01 运行态看板 | R2/R3/R7/R11 | 任务与 Agent 两张视图，数据来自事件流而非轮询群消息 |
| FR-02 可靠投递 | R3/R4 | 每条外发消息有状态；失败可重试；过期可对账 |
| FR-03 工具调用闸门 | R5/R6/R10 | 分类、放行/拦截/待批、审计四件事；身份由宿主注入 |
| FR-04 权限分层 | R5 | 至少分：公开 / 登录 / 资源访问 / 资源修改 / 高危执行 |
| FR-05 知识条目化 | R9 | Markdown 条目 + index/log 受保护 + 后台重建索引 |
| FR-06 知识检索接口 | R9 | 以 MCP 暴露，Agent 每轮可自动取 |
| FR-07 预算与记账 | R12 | 按 Agent 与任务记账，超限即停 |
| FR-08 阻塞与恢复 | R7 | 卡死检测、断点续跑 |
---
## 七、下一步
1. 立项书已出（同目录），本报告作为 D2 交付
1. 下一份是《需求文档 v0.1》：把上表八条 FR 拆到字段、接口、验收标准
1. 之后按里程碑 M2 先做闸门（O2 优先级最高），M3 做看板
