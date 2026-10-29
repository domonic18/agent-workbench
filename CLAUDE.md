# agent-workbench - Claude Code AI 上下文文件

## 1. 项目概览

- **愿景**: 把散落在飞书群、黑板表格、本地脚本里的多 Agent 协作，收进一个可看、可控、可计量的工作台——人能看清 Agent 在干什么，系统能拦住它不该干的事，账上能算清花了多少。
- **架构**: Node.js + TypeScript + SQLite；本地 Web 控制台（127.0.0.1:8787）+ frp 公网穿透；四屏：总览 / 任务 / 授权 / 知识
- **关键约束**:
  - 产品形态是「控制台 + 飞书」双面并存：控制台管状态与权力，飞书管说话与拍板；控制台不承担 IM 功能
  - 事实源在控制台库（task / a2a_message / capability / agent_run）；**不使用飞书黑板，不做投影**（2026-10-29 裁决）
  - 控制台只绑定 127.0.0.1:8787，不自己处理 TLS；提供 `/healthz`；经既有 frp 以 `aw.example.com` 暴露
  - 跨机：macmini 跑采集器（launchd，推会话事件）与 Teleport node agent，均回连控制台
  - 授权：SSH / 数据库访问走 Teleport CE + tbot 的 15 分钟短时证书，不自研证书签发
  - 不重写 Agent 运行时（Claude Code / cc-connect 是资产）

## 2. 项目结构

**⚠️ 执行任何任务前,先读本文件;涉及哪一层,再读 docs/ 对应 arch 文档(按需,勿全量加载)。**

- `src/` 源码(技术选型定稿后,各代码一级目录将建立专属 CLAUDE.md,在该目录工作前先读)
- `scripts/` 运维与工具脚本
- `tests/` 测试
- `workspace/` 宿主机持久化数据(SQLite 库、备份),gitignore 不入库
- 文档:requirement/(需求基准) arch/(终态方案) plan/development-plan.md(状态真相源) reference/(外部文档快照,不参与需求裁决)

| 主题 | 文档 |
| ---- | ---- |
| 项目定位与范围 | docs/requirement/01 |
| 总体架构 | docs/arch/00 |

## 3. 通用编码规范与 AI 指令

- 你最重要的工作是管理自己的上下文。规划变更前,务必先阅读相关文件。
- KISS、YAGNI、DRY;单文件不超过 350 行,超限即拆分。
- 未经用户批准不要提交到 git。不要主动创建 *.md/README。
- 永远不要模拟、不要占位符、不要省略代码;对想法的好坏坦率诚实。
- 安全:外部输入边界校验;密钥仅存 env(.env 不入库),永不硬编码;日志记事件不记敏感值。
- 状态只更新 plan/development-plan.md,不回填过程。

### CodeReview(每轮迭代完成后必须执行)

除静态检查与单元测试外,每轮迭代收尾前按以下三维度 Review 并优化,问题清零后方可收尾:

1. **代码规范性**:目录组织、文件/类/函数命名、无硬编码、常量按分层统一管理
2. **代码封装性**:职责单一、模块边界清晰、不泄漏内部实现、重复逻辑合理收敛
3. **代码架构合理性**:依赖方向与分层符合 docs/arch/00 约定,无越层访问、无循环依赖

Review 中发现的规范缺口回写对应 CLAUDE.md(事故驱动沉淀)。

## 4. 任务完成后协议

1. 运行类型检查 / lint / 测试(命令就绪后固化为 `make check`)
2. 每轮迭代完成后进行 CodeReview(按 §3 CodeReview 规范),问题清零后收尾
3. 行为变更同步 CLAUDE.md / docs 对应章节
4. 里程碑进展写入 docs/plan/development-plan.md

# 重要指令提醒

按要求做;不多不少。
