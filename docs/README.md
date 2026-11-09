# agent-workbench 文档中心

> 把散落在飞书群、黑板表格、本地脚本里的多 Agent 协作，收进一个可看、可控、可计量的工作台，并以事件驱动协调支撑一人组织多个 Agent 持续交付业务结果。
> 文档体系铁律:**requirement/ 是需求基准,arch/ 是终态方案,plan/ 是迭代状态真相源**;reference/ 只放外部文档快照,不参与需求裁决。
> 按需阅读,勿全量加载。

## 文档索引

### requirement/(需求基准)

| 文档 | 说明 |
|------|------|
| [01-requirement.md](requirement/01-requirement.md) | **唯一需求文档**：一人公司愿景与终态、介入边界、12 个用户场景与去重关系、用户价值优先级、首次使用自动装配、真实 Bug 闭环、协作形态与横切走查、分期范围、验收、裁决与开放问题 |

**控制台原型**（不在仓库内）：Ardot <https://ardot.tencent.com/file/741613178974645?node_id=0%3A1> —— 四屏桌面 + 任务详情抽屉 + 手机 390，共 6 屏；界面上的问号标注对应原文 §12 待确认项。

### arch/(架构设计 · 终态方案)

| 文档 | 说明 | 阅读时机 |
|------|------|----------|
| [00-总体架构设计.md](arch/00-总体架构设计.md) | 项目定位与 G1～G8、三平面、WorkItem/Mandate、确定性 Router、PostgreSQL、远程控制类 MCP、单 aw-node、目录与数据流 | 首次进入项目必读 |
| [01-后端服务设计.md](arch/01-后端服务设计.md) | 进程模型、认证、远程 Streamable HTTP MCP、A2A、发件箱、SSE、飞书、Trigger、RouteRule、worker_inbox 与真实 Bug 闭环 | 做后端/接口/事件协调时 |
| [02-数据服务设计.md](arch/02-数据服务设计.md) | PostgreSQL 表结构、WorkItem/Mandate/Assignment/Input/Handback、pg_trgm/pgvector、事件投影、一致性、greenfield 迁移与备份 | 改库、加字段或改协调模型时 |
| [03-前端设计.md](arch/03-前端设计.md) | `/setup` 首次使用引导、四屏主导航、工作事项与 worker_inbox 下钻、注意力队列、只读详情、WorkBuddy 空态、实时订阅与移动适配 | 做界面或首次使用流程时 |
| [04-采集器设计.md](arch/04-采集器设计.md) | 每机单 aw-node、采集断点续读、推送协议、缓冲重试、Claude Code 调度、WorkBuddy automations 与 launchd 部署 | 跨机采集或执行面部署时 |
| [05-授权与闸门设计.md](arch/05-授权与闸门设计.md) | 能力模型、Teleport、审批流、控制台自有控制工具判定、确定性路由授权与审计 | 做授权或路由权限时 |
| [06-架构评审记录.md](arch/06-架构评审记录.md) | 历史评审与历轮裁决，含被 2026-11-03 新基线 supersede 的旧方案；仅供核对当时证据，不直接作为现行架构 | 进入编码前、核对设计依据或拆分任务时 |
| [07-工程目录与维护约定评审.md](arch/07-工程目录与维护约定评审.md) | 目录组织/构建/docker/env/workspace 习惯对照与补齐清单 | 搭脚手架、改 Makefile 或 compose 前 |
| [diagrams/](arch/diagrams/) | 架构图与流程图(自包含 HTML,双击即可打开,含明暗主题与动效);与分册正文同源维护,不另存 PNG | 想一眼看全链路运转路径、闸门决策流或某个场景时 |

图示产出约定：用 `archify` skill 生成,工作目录 `.archify/` 属工具脚手架(不入库),
交付物放 `docs/arch/diagrams/`,文件名带主题前缀(如 `dispatch-coordination-*.html`)。

### research/(调研评估)

| 文档 | 说明 |
|------|------|
| （待补充） | 技术选型对比、可行性结论,编号递增 |

### reference/(参考资料 · 外部文档快照)

| 文档 | 说明 |
|------|------|
| [01-charter-v0.2.md](reference/01-charter-v0.2.md) | 飞书《立项书 · v0.2》原文快照（2026-10-29 落档） |
| [02-research-report-v0.1.md](reference/02-research-report-v0.1.md) | 飞书《调研报告 · 开源方案 · v0.1》原文快照（2026-10-29 落档） |
| [03-requirement-v0.7.md](reference/03-requirement-v0.7.md) | 飞书《需求文档 · v0.7》原文快照（2026-10-29 落档，文首含勘误与裁决标注；不参与裁决） |

### plan/(迭代计划 · 状态真相源)

**只放计划安排**：接下来做什么、做到哪一步、验收怎么判。方案与裁决在 `arch/`，
图示在 `arch/diagrams/`，外部文档快照在 `reference/`——三者都不进本目录。

| 文档 | 说明 |
|------|------|
| [development-plan.md](plan/development-plan.md) | 里程碑与完成状态;**只在此维护状态,不回填过程** |
| [tasks/](plan/tasks/) | 分里程碑任务清单(M0 / M1 / M1.5 / M2 / M2.5 / M3 / M3.5 / M3.8 / M3.9 / M3.10 / M4):任务、产出、依赖、验收点;不记进度 |
| [acceptance/](plan/acceptance/) | 按任务落档的验收记录(样本、实跑结果、缺口);点时快照,不回填新结论 |
| [resource-inventory.md](plan/resource-inventory.md) | 线上资源清单(主机、端口、容量、域名);只记事实不记密钥,真实值在 gitignored 的 `*.local.md` |

## 背景速览(新会话先看这里)

- 项目来源:飞书《【项目】智能体工作台 · 立项书 · v0.2》(2026-10-29 立项,提出:诸葛东明,承办:随行-小W)
- 核心决策:控制台 + 飞书双面并存;PostgreSQL 为业务事实源;控制台同一 HTTP 服务提供自有控制类 MCP，执行机每机仅一个 aw-node;本机第三方 MCP 与原生工具出界;Source 只整理事实，新工作按 `Thread owner → Git RouteRule → needs_person` 确定性分配;首次使用以无凭据 bootstrap mode、`/setup` 四步、一次性 enroll token、aw-node 上报发现和配置轮换签发与 ACK 完成自动装配，预检失败不就绪;真实 Bug 以 PR+CI 待验收、合并 PR 即自动验收收口(人工兜底接受/退回经原 Bug 机器人)
- 当前阶段:以 [plan/development-plan.md](plan/development-plan.md) 为准（本文件不维护进度,避免出现第二份状态）
