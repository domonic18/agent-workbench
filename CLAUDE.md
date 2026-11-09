# agent-workbench - Claude Code AI 上下文文件

## 1. 项目概览

- **愿景**: 把散落在飞书群、黑板表格、本地脚本里的多 Agent 协作，收进一个可看、可控、可计量的工作台——人能看清 Agent 在干什么，系统能拦住它不该干的事，账上能算清花了多少。
- **架构**: Node.js + TypeScript + PostgreSQL（同机 Docker Compose，`pg_trgm` + `pgvector`）；控制台容器内监听 `0.0.0.0:8787`、宿主机仅 `127.0.0.1:8787` 暴露（公网入口属部署环境，项目栈不含隧道）；四屏：总览 / 任务 / 授权 / 知识，外加「接入」组两屏——协作接入（`/agent-access`：两种接入方式对照、接入参数、Agent 名册、轮换密钥、签发一次性接入令牌后**弹窗给出「接入包」**（控制台地址+令牌+三步命令一段文本，人整段粘给 Agent）、各客户端就绪配置片段——**明文版**（Claude Code / 通用 MCP / WorkBuddy）与 **env 版**（凭据写成 `${AW_AGENT_SECRET}`，给支持变量展开的客户端，配置文件可进仓库））与 Agent 手册（`/agent-guide`：A2A 协作规范正文、工作区提示词、`SKILL.md` 下载；页头提示 Agent 自己拉的是 `/api/agent-kit/guide` 接口而非网页）
- **关键约束**:
  - 产品形态是「控制台 + 飞书」双面并存：控制台管状态与权力，飞书管说话与拍板；控制台不承担 IM 功能
  - 事实源在控制台 PostgreSQL（work_item / work_trigger / worker_inbox / task / a2a_message / capability / agent_run）；WorkItem 的 Mandate 与 Task/Run 分离，Assignment/Input/Handback 不冒充 A2A；**不使用飞书黑板，不做投影**
  - 控制台容器内监听 `0.0.0.0:8787`，宿主机仅通过 `127.0.0.1:8787` 发布，不自己处理 TLS；提供 `/healthz`；**公网入口由部署环境自备**（2026-11-09 裁决：项目面向开源、不假设用户用 frp，compose 只起 console + postgres 两件套；当前实例经部署机上独立运维的 frpc + nginx 暴露，与仓库无关）
  - 会话 Cookie 的 `Secure` 标记**按请求逐次判断**（控制台自身走 http，一刀切加 `Secure` 会让明文链路的登录被浏览器拒收、静默失效）：`AW_TRUST_PROXY=1` 才采信可信代理（回环 / 私网网段）的 `X-Forwarded-Proto`；基础安全响应头（`nosniff` / `X-Frame-Options` / `Referrer-Policy` / `Permissions-Policy`）由应用统一下发，**HSTS 归 TLS 终结点**。公网入口的 nginx 已终止 TLS，但**尚未下发 `X-Forwarded-Proto`**，补上 `proxy_set_header X-Forwarded-Proto $scheme;` 后 `Secure` 自动生效（控制台侧不用再改）
  - **Teleport 占位（2026-11-09 裁决）**：暂不开工，优先优化 Agent 协作机制；原案的公网入口（`tp.example.com:8443 → 443` 独立 tcp，避开 frps HTTPS vhost 占用的 443）属部署环境细节，项目已不交付任何 frpc 配置
  - 跨机：每台运行 Agent 的机器只跑一个 `aw-node`（采集 + Claude Code 调度），launchd 常驻，采集模块只经 `/api/ingest` 单向推送；无 aw-node 的外部运行时（WorkBuddy/Codex/DeepSeek harness）拿 Agent Bearer 直接打 `/mcp`、用官方 automations 轮询，首版 Run/对话/Token 显示「未接入 / —」；**`agent.machine_id` 语义是「宿主机器」**（外部运行时可绑可解绑，只登记归属）；**有没有过程数据看两个条件：`runtime='claude_code'` 且 `machine_id` 非空**，不是单看机器绑定；Teleport node agent 装目标机
  - 授权：SSH / 数据库访问走 Teleport CE + tbot 的 15 分钟短时证书，不自研证书签发；身份按 Agent 建 bot、任务以 trait `aw_task_id` 携带，证书扩展用 `external.*` 插值（`internal.*` 不插值）；Teleport CE 为 AGPL-3.0，独立容器运行，只经 API 调用
  - **派发协调（2026-11-09 M3.10）**：唤醒不是「有活就起会话」。aw-node 在 spawn 前过闸门链 G1–G4——同一 Agent 已有会话在跑 / cwd 有活跃 Claude Code 会话在写（按会话文件 mtime 双采样判定，**不取 `streams.updatedAt`**，它每轮扫描必刷新恒为活跃）/ cwd 工作区脏 / 全机活跃会话数达上限（默认 2）。**挡下 ≠ 取消**：挂起只写 `worker_inbox.reason` 并在首跳向协作群播报一次，条件消失后下一轮自动放行；连续被挡达轮数退避 5min。派发交付按批次：单批 ≤8 件、同批单分支分 commit、**一个 PR（body 逐行 Fixes #N）**、单件修不了 handback 不卡整批。控制台后台作业 `src/server/jobs/zombie-reclaim.ts` 兜底：running 超 2h 转 blocked、无存活 task 的已 acked assignment 重置 pending 重排（同事项 ≤2 次，超限标 stalled 留人）、pending 超 24h 升级播报。**aw-node 自起的会话必须能被归因**——spawn 前预生成 session uuid（`claude --session-id`）并登记进采集器本地**活引用**归因注册表，否则按 04 §4 档 3 不推送，控制台侧 `agent_run` 零行（11-08 事故实测）
  - **三平面**：展示面（浏览器 B/S，不做任何约束判定）/ 控制面（策略、判定、审计、确定性 Router）/ 执行面（每台机一个 `aw-node`）。控制台经同一 HTTP 服务提供远程 Streamable HTTP MCP，只含 `task / a2a / kb / work` 控制工具，以 Agent Bearer 鉴权并由服务端校验归属，**不引入 run_token**；**本机第三方 MCP、Claude Code 原生工具与终端直跑均不在项目管控边界内**（2026-11-03 裁决）；一期不做 OS 级沙箱、托盘与进程急停。**Agent 接入套件**（`src/mcp/agent-kit/`）：A2A 协作规范正文、工作区提示词与工具速查表由**同一套工具注册表**在服务端渲染（`GET /api/agent-kit/guide`、`/api/agent-kit/skill`，**控制台会话或 Agent Bearer 均可读**），另注册只读工具 `a2a_guide` 让 Agent 自助拉规范；改工具不用改规范
  - **接入通道：REST 为主、MCP 可选**（2026-11-07 裁决）。协作不必先配 MCP：Bearer 直调的 REST 面已覆盖建任务、发消息、拉收件箱、回执，`kb_*` / `work_*` 无 REST 写面、只能走 MCP。人替 Agent 接入的完整路径：控制台签发**一次性接入令牌** → 只把令牌交给 Agent → Agent 自助兑换密钥（兑换才轮换旧密钥，签发不影响在跑的 Agent）→ 凭 Bearer 拉规范（`GET /api/agent-kit/guide`）与查可达目标（`GET /api/agent/peers`，白名单属发起方）→ 按规范委派；**人全程不改 Agent 客户端配置**。规范正文明确「不要用 IM 代替委派」：控制台只认 A2A 消息
  - 不重写 Agent 运行时（Claude Code / cc-connect 是资产）；Source Agent 只整理事实，业务路由只查 Thread owner 与 Git 版本化 RouteRule，未知或冲突交人，**一期不做在线 Slow Router**
  - 首个业务闭环使用真实 Bug：PR 关联且当前提交 CI 通过后进入待验收，**只有原 Bug 机器人的人工接受才完成**；退回到同一 WorkItem 返工，A2A ACK 只代表上游 Task 验收，生产发布始终单独确认
  - **发布模型（2026-11-09 裁决，单栈一体）**：短期分支 + PR 合入 `main` 即自动发布——PR 三查（类型与 lint / 单元测试 / 迁移守卫 `scripts/check-migrations.ts`）全绿才可合并；合入后自托管 runner 构建并推送 TCR 不可变 tag（`main-<sha7>`，不推 latest），再部署到**专用部署目录**（仓库变量 `DEPLOY_PATH`，非 git 工作副本，compose 项目名 `agent-workbench` 延用旧栈数据卷）；部署唯一入口 `scripts/deploy.sh`（预检 → `.env` 轮转 → 换容器 → `.deploy-state` → 失败自动回滚 previous tag → 退出兜底镜像回收，保留最近 3 个 tag）。迁移 SQL 内嵌镜像、应用启动自跑（forward-only + checksum 锁），**回滚不回滚数据库**，新 DDL 必须旧代码可容忍。自托管 job（build/deploy/image-gc）**绝不跑 PR**。本地操作生产栈须 `make <target> DEPLOY_PATH=...`，**不要用仓库 compose 现场构建**（同项目名会把 CI 镜像换成本地构建）；详见 docs/deployment-runbook.md
  - **首次使用必须自动装配**：无凭据仅开放 bootstrap mode，以一次性 bootstrap token 设置管理员口令；`/setup` 四步引导 + enroll token + aw-node 上报 cc-connect 发现 + `POST /api/aw-node/config` 轮换签发 secret（ACK 前重试可轮换，ACK 后不明文返回）+ 默认 `bug_fix` + 分项预检。用户只做必要授权、一次安装执行和一次确认，不要求手工编辑 RouteRule、Mandate、plist 或数据库配置；预检失败不就绪且不创建空 Assignment

## 2. 项目结构

**⚠️ 执行任何任务前,先读本文件;涉及哪一层,再读 docs/ 对应 arch 文档(按需,勿全量加载)。**

- `src/` 服务端源码(server / application / domain / reliability / store / adapters / mcp / config / shared);技术选型定稿后各一级目录建专属 CLAUDE.md,在该目录工作前先读;`src/mcp/` 是控制台远程 MCP 协议层,判定仍取 `src/domain/capability/`，不含执行机 proxy
- `web/` React SPA 源码(pages / components / api / stores / shared),产物 `dist/` 由后端同源托管
- `collector/` aw-node 采集模块源码；与调度模块共同构建每机单一 aw-node 产物，与 `src/shared` 共享协议类型
- `scripts/` 运维与工具脚本(备份等)
- `e2e/` 端到端与冒烟测试;单元测试就近放在被测文件旁,不另设顶层单测目录
- `docker/` 容器化(Dockerfile.console / docker-compose.yml 本地模板 / docker-compose.prod.yml 生产镜像化)
- `workspace/` 宿主机持久化数据（PostgreSQL 数据与备份、采集缓冲），gitignore 不入库；新基线从空库与空知识目录开始，旧 SQLite 与旧知识文件只归档、不导入

工程入口:pnpm workspace(根包 + `web/` + `collector/`)、TypeScript、ESLint、Vitest;命令统一走 `Makefile`,`make check` 是唯一质量闸门。
- 文档:requirement/(需求基准) arch/(终态方案) arch/diagrams/(架构图与流程图) plan/development-plan.md(状态真相源) + plan/tasks/(M0~M4 任务清单，含 M3.8/M3.9/M3.10，只描述任务与依赖，不记进度) reference/(外部文档快照，不参与需求裁决)。**plan/ 只放计划安排**：方案与裁决回写 arch，图示回写 arch/diagrams

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
| 架构图与流程图（自包含 HTML；用 archify skill 出图，交付物放此目录） | docs/arch/diagrams/ |
| 发布与回滚手册（流水线 / deploy.sh / 回滚 / 排障） | docs/deployment-runbook.md |
| 里程碑任务清单（开工前看对应 Mx） | docs/plan/tasks/ |

## 3. 通用编码规范与 AI 指令

- 你最重要的工作是管理自己的上下文。规划变更前,务必先阅读相关文件。
- KISS、YAGNI、DRY;单文件不超过 350 行,超限即拆分。
- 未经用户批准不要提交到 git。不要主动创建 *.md/README。
- 永远不要模拟、不要占位符、不要省略代码;对想法的好坏坦率诚实。
- 安全:外部输入边界校验;系统密钥仅存 env(.env 不入库),Agent / 采集器密钥库中只存哈希,永不硬编码;日志记事件不记敏感值,**命令行参数与 shell history 同样不得出现明文密钥,部署示例一律用占位符并采用隐藏输入/stdin/env 注入**。**仓库是公开的**:文档与示例不写真实 IP、域名、主机名、SSH 路径与内网端口,真实值只放 gitignored 的 `docs/plan/*.local.md`。
- e2e/联测脚本:无 body 的 POST 不要带 `content-type: application/json`——Fastify 以 400 拒空 body,失败响应形状错位会伪装成下游故障(s9 曾把坏 Bearer 掩护成假 401);依赖响应字段前先断言 HTTP 状态码。**联测脚本自建的 Agent 必须跑完即删**(用 `e2e/lib/cleanup.mjs`),否则库里攒测试垃圾淹没总览与路由注册表。
- **单元测试库会残留**:每个测试文件自建 `aw_test_*` 随机库,正常由 `createTestDatabase` 的 close() 销毁;文件中途失败或 worker 被回收时删不掉,残留越积越多会把 PG 目录撑大、`CREATE DATABASE` 变慢、跑批超时——2026-11-09 曾积到 3405 个残留库,`make check` 直接假红。`vitest.config.ts` 的 globalSetup（`src/store/test-db-gc.ts`）每跑批前回收**早于 1 小时**的残留库;看到 `[test-db-gc] 回收陈旧测试库 N 个` 是正常自愈,不必手工处理。
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
