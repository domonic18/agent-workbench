# agent-workbench - Claude Code AI 上下文文件

## 1. 项目概览

- **愿景**: 把散落在飞书群、黑板表格、本地脚本里的多 Agent 协作，收进一个可看、可控、可计量的工作台——人能看清 Agent 在干什么，系统能拦住它不该干的事，账上能算清花了多少。
- **架构**: Node.js + TypeScript + SQLite；本地 Web 控制台（127.0.0.1:8787）+ frp 公网穿透；四屏：总览 / 任务 / 授权 / 知识
- **关键约束**:
  - 产品形态是「控制台 + 飞书」双面并存：控制台管状态与权力，飞书管说话与拍板；控制台不承担 IM 功能
  - 事实源在控制台库（task / a2a_message / capability / agent_run）；**不使用飞书黑板，不做投影**（2026-10-29 裁决）
  - 控制台只绑定 127.0.0.1:8787，不自己处理 TLS；提供 `/healthz`；经 frp 以 `aw.17aitech.com` 暴露
  - frpc 两条独立规则：`aw.17aitech.com → 8787`（http）、`tp.17aitech.com:8443 → 443`（tcp，给 Teleport proxy；443 已被 frps 的 HTTPS vhost 占用），互不复用
  - 跨机：每台运行 Agent 的机器各跑一个采集器（MacBook、macmini），launchd 常驻，只经 `/api/ingest` 单向推送；Teleport node agent 装目标机
  - 授权：SSH / 数据库访问走 Teleport CE + tbot 的 15 分钟短时证书，不自研证书签发；Teleport CE 为 AGPL-3.0，独立容器运行，只经 API 调用
  - **三平面**：展示面（浏览器 B/S，不做任何约束判定）/ 控制面（策略、判定、审计）/ 执行面（每台机本地 C/S：采集器、MCP proxy、Claude Code 配置托管）。约束只在后两者执行；原生工具靠托管权限规则 + `PreToolUse` hook 拦截，hook 不可用即拒绝启动；**一期不做 OS 级沙箱**，终端直跑会话不受拦截（缺口见 06 O6）；托盘与进程急停不入一期（2026-10-31 裁决）
  - 不重写 Agent 运行时（Claude Code / cc-connect 是资产）

## 2. 项目结构

**⚠️ 执行任何任务前,先读本文件;涉及哪一层,再读 docs/ 对应 arch 文档(按需,勿全量加载)。**

- `src/` 服务端源码(server / domain / reliability / store / adapters / config / shared);技术选型定稿后各一级目录建专属 CLAUDE.md,在该目录工作前先读
- `web/` React SPA 源码(pages / components / api / stores / shared),产物 `dist/` 由后端同源托管
- `collector/` 跨机采集器,独立构建产物;与 `src/shared` 共享协议类型
- `scripts/` 运维与工具脚本(备份等)
- `e2e/` 端到端与冒烟测试;单元测试就近放在被测文件旁,不另设顶层单测目录
- `docker/` 容器化(Dockerfile.console / docker-compose.yml / frpc.toml.example)
- `workspace/` 宿主机持久化数据(SQLite 库、备份、采集缓冲),gitignore 不入库

工程入口:pnpm workspace(根包 + `web/` + `collector/`)、TypeScript、ESLint、Vitest;命令统一走 `Makefile`,`make check` 是唯一质量闸门。
- 文档:requirement/(需求基准) arch/(终态方案) plan/development-plan.md(状态真相源) + plan/tasks/(M0~M4 任务清单,只描述任务与依赖,不记进度) reference/(外部文档快照,不参与需求裁决)

**共享边界**:`src/shared` 只放服务端与采集器共用的协议类型、错误码、常量(web 以路径别名引用,不复制);`web/src/shared` 只放纯前端的展示映射与格式化。禁止两侧各维护一份业务枚举。

| 主题 | 文档 |
| ---- | ---- |
| 项目定位与范围 | docs/requirement/01 |
| 总体架构（部署 / 选型 / 目录 / 数据流） | docs/arch/00 |
| 后端服务（API / A2A / 发件箱 / SSE / 飞书） | docs/arch/01 |
| 数据服务（表设计 / 事件日志 / 迁移 / 备份） | docs/arch/02 |
| 前端（四屏 / 路由 / 实时订阅 / 移动适配） | docs/arch/03 |
| 采集器（断点续读 / 推送 / 缓冲 / 部署） | docs/arch/04 |
| 授权与闸门（能力模型 / Teleport / 审批 / 调用策略） | docs/arch/05 |
| 架构评审（缺口清单 / 复审结论 / 开放项） | docs/arch/06 |
| 工程目录与维护约定 | docs/arch/07 |
| 里程碑任务清单（开工前看对应 Mx） | docs/plan/tasks/ |

## 3. 通用编码规范与 AI 指令

- 你最重要的工作是管理自己的上下文。规划变更前,务必先阅读相关文件。
- KISS、YAGNI、DRY;单文件不超过 350 行,超限即拆分。
- 未经用户批准不要提交到 git。不要主动创建 *.md/README。
- 永远不要模拟、不要占位符、不要省略代码;对想法的好坏坦率诚实。
- 安全:外部输入边界校验;系统密钥仅存 env(.env 不入库),Agent / 采集器密钥库中只存哈希,永不硬编码;日志记事件不记敏感值。
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
