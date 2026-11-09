# agent-workbench

> 把散落在飞书群、黑板表格、本地脚本里的多 Agent 协作，收进一个可看、可控、可计量的工作台。

## 技术栈

- Node.js + TypeScript
- PostgreSQL（控制台业务库，`pg_trgm` + `pgvector`）
- 控制台：容器内监听 `0.0.0.0:8787`，宿主机仅通过 `127.0.0.1:8787` 暴露；公网入口（TLS / 反代 / 域名）由部署环境自备

## 快速开始

```bash
# 1. 复制环境变量
cp .env.example .env

# 2. 安装依赖与 git hooks
make install

# 3. 启动控制台与前端
make dev

# 4. 质量检查(类型 / lint / 测试)
make check
```

## 文档

完整文档见 [docs/README.md](docs/README.md)：

- **需求基准**：[docs/requirement/](docs/requirement/)
- **架构设计**：[docs/arch/](docs/arch/)
- **迭代计划**：[docs/plan/development-plan.md](docs/plan/development-plan.md)
- **调研评估**：[docs/research/](docs/research/)

## 目录结构

```
docs/        文档中心（需求基准 / 架构终态 / 迭代计划 / 调研评估）
web/         React SPA 源码，产物 dist/ 由后端同源托管
collector/   aw-node 执行面源码（采集 + Claude Code 调度）
docker/      容器化（Dockerfile.console / docker-compose.yml / docker-compose.prod.yml）
e2e/         端到端与冒烟测试
scripts/     运维与工具脚本
src/         服务端源码
workspace/   宿主机持久化数据（PostgreSQL 数据与备份、采集缓冲，gitignore 不入库）
```
