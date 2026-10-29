# agent-workbench

> 把散落在飞书群、黑板表格、本地脚本里的多 Agent 协作，收进一个可看、可控、可计量的工作台。

## 技术栈

- Node.js + TypeScript
- SQLite（嵌入式存储，单机优先）
- 控制台：本地 Web 服务，绑定 `127.0.0.1:8787`，经 frp 穿透访问

## 快速开始

```bash
# 1. 复制环境变量
cp .env.example .env

# 2. 安装依赖（package.json 就绪后）
npm install

# 3. 启动控制台（脚本就绪后）
npm run dev
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
scripts/     运维与工具脚本
src/         源码
tests/       测试
workspace/   宿主机持久化数据（SQLite 库、备份，gitignore 不入库）
```
