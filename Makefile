.DEFAULT_GOAL := help
COMPOSE := docker compose -p agent-workbench --env-file .env -f docker/docker-compose.yml

.PHONY: help install dev typecheck lint test check build up down logs restart backup

help: ## 列出所有可用目标
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## 安装依赖(pnpm install)
	pnpm install

dev: ## 启动控制台(开发模式,tsx watch)
	pnpm run dev

typecheck: ## 类型检查
	pnpm run typecheck

lint: ## ESLint
	pnpm run lint

test: ## 单元测试(Vitest)
	pnpm run test

check: typecheck lint test ## 质量闸门:类型 + lint + 测试

build: ## 生产构建(输出 dist/)
	pnpm run build

up: ## 启动容器(console + 可选 frpc)
	$(COMPOSE) up -d --build

down: ## 停止并移除容器
	$(COMPOSE) down

logs: ## 跟踪容器日志
	$(COMPOSE) logs -f --tail=100

restart: ## 重启 console
	$(COMPOSE) restart console

backup: ## 备份 SQLite 库到 workspace/backups
	./scripts/backup.sh
