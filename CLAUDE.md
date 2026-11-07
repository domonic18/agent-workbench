# agent-workbench - Claude Code AI 上下文文件

## 1. 项目概览

- **愿景**: 把散落在飞书群、黑板表格、本地脚本里的多 Agent 协作，收进一个可看、可控、可计量的工作台——人能看清 Agent 在干什么，系统能拦住它不该干的事，账上能算清花了多少。
- **架构**: Node.js + TypeScript + PostgreSQL（同机 Docker Compose，`pg_trgm` + `pgvector`）；控制台容器内监听 `0.0.0.0:8787`、宿主机仅 `127.0.0.1:8787` 暴露 + frp 公网穿透；四屏：总览 / 任务 / 授权 / 知识，外加「接入」组两屏——协作接入（`/agent-access`：两种接入方式对照、接入参数、Agent 名册、轮换密钥、签发一次性接入令牌后**弹窗给出「接入包」**（控制台地址+令牌+三步命令一段文本，人整段粘给 Agent）、各客户端就绪配置片段——**明文版**（Claude Code / 通用 MCP / WorkBuddy）与 **env 版**（凭据写成 `${AW_AGENT_SECRET}`，给支持变量展开的客户端，配置文件可进仓库））与 Agent 手册（`/agent-guide`：A2A 协作规范正文、工作区提示词、`SKILL.md` 下载；页头提示 Agent 自己拉的是 `/api/agent-kit/guide` 接口而非网页）
- **关键约束**:
  - 产品形态是「控制台 + 飞书」双面并存：控制台管状态与权力，飞书管说话与拍板；控制台不承担 IM 功能
  - 事实源在控制台 PostgreSQL（work_item / work_trigger / worker_inbox / task / a2a_message / capability / agent_run）；WorkItem 的 Mandate 与 Task/Run 分离，Assignment/Input/Handback 不冒充 A2A；**不使用飞书黑板，不做投影**
  - 控制台容器内监听 `0.0.0.0:8787`，宿主机仅通过 `127.0.0.1:8787` 发布，不自己处理 TLS；提供 `/healthz`；经 frp 以 `aw.example.com` 暴露
  - frpc 两条独立规则：`aw.example.com → 8787`（http）、`tp.example.com:8443 → 443`（tcp，给 Teleport proxy；443 已被 frps 的 HTTPS vhost 占用），互不复用
  - 跨机：每台运行 Agent 的机器只跑一个 `aw-node`（采集 + Claude Code 调度），launchd 常驻，采集模块只经 `/api/ingest` 单向推送；无 aw-node 的外部运行时（WorkBuddy/Codex/DeepSeek harness）拿 Agent Bearer 直接打 `/mcp`、用官方 automations 轮询，首版 Run/对话/Token 显示「未接入 / —」；**`agent.machine_id` 语义是「宿主机器」**（外部运行时可绑可解绑，只登记归属）；**有没有过程数据看两个条件：`runtime='claude_code'` 且 `machine_id` 非空**，不是单看机器绑定；Teleport node agent 装目标机
  - 授权：SSH / 数据库访问走 Teleport CE + tbot 的 15 分钟短时证书，不自研证书签发；身份按 Agent 建 bot、任务以 trait `aw_task_id` 携带，证书扩展用 `external.*` 插值（`internal.*` 不插值）；Teleport CE 为 AGPL-3.0，独立容器运行，只经 API 调用
  - **三平面**：展示面（浏览器 B/S，不做任何约束判定）/ 控制面（策略、判定、审计、确定性 Router）/ 执行面（每台机一个 `aw-node`）。控制台经同一 HTTP 服务提供远程 Streamable HTTP MCP，只含 `task / a2a / kb / work` 控制工具，以 Agent Bearer 鉴权并由服务端校验归属，**不引入 run_token**；**本机第三方 MCP、Claude Code 原生工具与终端直跑均不在项目管控边界内**（2026-11-03 裁决）；一期不做 OS 级沙箱、托盘与进程急停。**Agent 接入套件**（`src/mcp/agent-kit/`）：A2A 协作规范正文、工作区提示词与工具速查表由**同一套工具注册表**在服务端渲染（`GET /api/agent-kit/guide`、`/api/agent-kit/skill`，**控制台会话或 Agent Bearer 均可读**），另注册只读工具 `a2a_guide` 让 Agent 自助拉规范；改工具不用改规范
  - **接入通道：REST 为主、MCP 可选**（2026-11-07 裁决）。协作不必先配 MCP：Bearer 直调的 REST 面已覆盖建任务、发消息、拉收件箱、回执，`kb_*` / `work_*` 无 REST 写面、只能走 MCP。人替 Agent 接入的完整路径：控制台签发**一次性接入令牌** → 只把令牌交给 Agent → Agent 自助兑换密钥（兑换才轮换旧密钥，签发不影响在跑的 Agent）→ 凭 Bearer 拉规范（`GET /api/agent-kit/guide`）与查可达目标（`GET /api/agent/peers`，白名单属发起方）→ 按规范委派；**人全程不改 Agent 客户端配置**。规范正文明确「不要用 IM 代替委派」：控制台只认 A2A 消息
  - 不重写 Agent 运行时（Claude Code / cc-connect 是资产）；Source Agent 只整理事实，业务路由只查 Thread owner 与 Git 版本化 RouteRule，未知或冲突交人，**一期不做在线 Slow Router**
  - 首个业务闭环使用真实 Bug：PR 关联且当前提交 CI 通过后进入待验收，**只有原 Bug 机器人的人工接受才完成**；退回到同一 WorkItem 返工，A2A ACK 只代表上游 Task 验收，生产发布始终单独确认
  - **首次使用必须自动装配**：无凭据仅开放 bootstrap mode，以一次性 bootstrap token 设置管理员口令；`/setup` 四步引导 + enroll token + aw-node 上报 cc-connect 发现 + `POST /api/aw-node/config` 轮换签发 secret（ACK 前重试可轮换，ACK 后不明文返回）+ 默认 `bug_fix` + 分项预检。用户只做必要授权、一次安装执行和一次确认，不要求手工编辑 RouteRule、Mandate、plist 或数据库配置；预检失败不就绪且不创建空 Assignment

## 2. 项目结构

**⚠️ 执行任何任务前,先读本文件;涉及哪一层,再读 docs/ 对应 arch 文档(按需,勿全量加载)。**

- `src/` 服务端源码(server / application / domain / reliability / store / adapters / mcp / config / shared);技术选型定稿后各一级目录建专属 CLAUDE.md,在该目录工作前先读;`src/mcp/` 是控制台远程 MCP 协议层,判定仍取 `src/domain/capability/`，不含执行机 proxy
- `web/` React SPA 源码(pages / components / api / stores / shared),产物 `dist/` 由后端同源托管
- `collector/` aw-node 采集模块源码；与调度模块共同构建每机单一 aw-node 产物，与 `src/shared` 共享协议类型
- `scripts/` 运维与工具脚本(备份等)
- `e2e/` 端到端与冒烟测试;单元测试就近放在被测文件旁,不另设顶层单测目录
- `docker/` 容器化(Dockerfile.console / docker-compose.yml / frpc.toml.example)
- `workspace/` 宿主机持久化数据（PostgreSQL 数据与备份、采集缓冲），gitignore 不入库；新基线从空库与空知识目录开始，旧 SQLite 与旧知识文件只归档、不导入

工程入口:pnpm workspace(根包 + `web/` + `collector/`)、TypeScript、ESLint、Vitest;命令统一走 `Makefile`,`make check` 是唯一质量闸门。
- 文档:requirement/(需求基准) arch/(终态方案) plan/development-plan.md(状态真相源) + plan/tasks/(M0~M4 任务清单，含 M3.8/M3.9，只描述任务与依赖，不记进度) reference/(外部文档快照，不参与需求裁决)

**共享边界**:`src/shared` 只放服务端与 aw-node 共用的协议类型、错误码、常量(web 以路径别名引用,不复制);`web/src/shared` 只放纯前端的展示映射与格式化。禁止两侧各维护一份业务枚举。

| 主题 | 文档 |
| ---- | ---- |
| 项目定位与范围 | docs/requirement/01 |
| 总体架构（部署 / 选型 / 目录 / 数据流） | docs/arch/00 |
| 后端服务（API / 远程控制类 MCP / A2A / 发件箱 / SSE / 确定性 Router） | docs/arch/01 |
| 数据服务（PostgreSQL 表设计 / 事件日志 / 迁移 / 备份） | docs/arch/02 |
| 前端（四屏 / 路由 / 实时订阅 / 移动适配） | docs/arch/03 |
| aw-node 执行面（采集断点续读 / 推送 / 缓冲 / 调度 / 部署） | docs/arch/04 |
| 授权与闸门（能力模型 / Teleport / 审批 / 自有控制工具策略） | docs/arch/05 |
| 架构评审（历史缺口与裁决；旧方案可能已被新裁决 supersede） | docs/arch/06 |
| 工程目录与维护约定 | docs/arch/07 |
| 里程碑任务清单（开工前看对应 Mx） | docs/plan/tasks/ |

## 3. 通用编码规范与 AI 指令

- 你最重要的工作是管理自己的上下文。规划变更前,务必先阅读相关文件。
- KISS、YAGNI、DRY;单文件不超过 350 行,超限即拆分。
- 未经用户批准不要提交到 git。不要主动创建 *.md/README。
- 永远不要模拟、不要占位符、不要省略代码;对想法的好坏坦率诚实。
- 安全:外部输入边界校验;系统密钥仅存 env(.env 不入库),Agent / 采集器密钥库中只存哈希,永不硬编码;日志记事件不记敏感值,**命令行参数与 shell history 同样不得出现明文密钥,部署示例一律用占位符并采用隐藏输入/stdin/env 注入**。**仓库是公开的**:文档与示例不写真实 IP、域名、主机名、SSH 路径与内网端口,真实值只放 gitignored 的 `docs/plan/*.local.md`。
- e2e/联调脚本:无 body 的 POST 不要带 `content-type: application/json`——Fastify 以 400 拒空 body,失败响应形状错位会伪装成下游故障(s9 曾把坏 Bearer 掩护成假 401);依赖响应字段前先断言 HTTP 状态码。**联测脚本自建的 Agent 必须跑完即删**(用 `e2e/lib/cleanup.mjs`),否则库里攒测试垃圾淹没总览与路由注册表。
- 前端:样式走 `web/src/global.css` 的设计令牌与 `web/src/components/ui/` 基元层,不写死颜色/间距/字号,不在组件里新造按钮与表格 class;基元不得 import `api/` 层。详见 docs/arch/03 §10。
- 状态只更新 plan/development-plan.md,不回填过程。

### CodeReview(每轮迭代完成后必须执行)

除静态检查与单元测试外,每轮迭代收尾前按以下三维度 Review 并优化,问题清零后方可收尾:

1. **代码规范性**:目录组织、文件/类/函数命名、无硬编码、常量按分层统一管理
2. **代码封装性**:职责单一、模块边界清晰、不泄漏内部实现、重复逻辑合理收敛
3. **代码架构合理性**:依赖方向与分层符合 docs/arch/00 约定,无越层访问、无循环依赖

Review 中发现的规范缺口回写对应 CLAUDE.md(事故驱动沉淀)。

## 4. 任务完成后协议

1. 运行 `make check`(类型检查 + lint + 测试)
2. 每轮迭代完成后进行 CodeReview(按 §3 CodeReview 规范),问题清零后收尾
3. 行为变更同步 CLAUDE.md / docs 对应章节
4. 里程碑进展写入 docs/plan/development-plan.md

# 重要指令提醒

按要求做;不多不少。
