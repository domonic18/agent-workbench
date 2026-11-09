.DEFAULT_GOAL := help
# 生产栈由 CI 部署到专用部署目录(docs/deployment-runbook.md §1/§7);旧口径
# 「本仓 make up 现场构建」已退役——同一 compose 项目名会把 CI 部署的容器
# 换成本地构建的镜像。操作生产栈须显式给 DEPLOY_PATH:
#   make logs DEPLOY_PATH=<部署目录>
DEPLOY_PATH ?=
COMPOSE_PROD = docker compose -p agent-workbench --env-file $(DEPLOY_PATH)/.env -f $(DEPLOY_PATH)/docker/docker-compose.prod.yml

.PHONY: help install dev dev-web typecheck lint test check build up down logs restart backup deploy-guard

help: ## 列出所有可用目标
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## 安装依赖(pnpm install)
	pnpm install

dev: ## 启动控制台(开发模式,tsx watch)
	pnpm run dev

dev-web: ## 启动前端开发服务器(代理 /api 到 8787)
	pnpm run dev:web

typecheck: ## 类型检查(后端 + web)
	pnpm run typecheck
	pnpm run typecheck:web

lint: ## ESLint
	pnpm run lint

test: ## 单元测试(Vitest,后端 + web;连本机 5433 的 postgres)
	pnpm run test
	pnpm run test:web

check: typecheck lint test ## 质量闸门:类型 + lint + 测试

build: ## 生产构建(输出 dist/)
	pnpm run build

deploy-guard:
	@if [ -z "$(DEPLOY_PATH)" ]; then echo "ERROR: 需要 DEPLOY_PATH=<部署目录>(见 docs/deployment-runbook.md §7)" >&2; exit 1; fi

up: deploy-guard ## 启动生产栈(DEPLOY_PATH;镜像取 .env 的 IMAGE,不构建)
	$(COMPOSE_PROD) up -d --no-build

down: deploy-guard ## 停止并移除生产栈容器
	$(COMPOSE_PROD) down

logs: deploy-guard ## 跟踪生产栈日志
	$(COMPOSE_PROD) logs -f --tail=100

restart: deploy-guard ## 重启生产栈 console
	$(COMPOSE_PROD) restart console

backup: deploy-guard ## 备份 PostgreSQL 到部署目录 workspace/backups(保留最近 14 份)
	BACKUP_DIR="$(DEPLOY_PATH)/workspace/backups" COMPOSE="$(COMPOSE_PROD)" ./scripts/backup.sh
