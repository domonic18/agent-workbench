.DEFAULT_GOAL := help
COMPOSE := docker compose -p agent-workbench --env-file .env -f docker/docker-compose.yml

.PHONY: help install dev dev-web typecheck lint test check build up down logs restart backup agent-bundle

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

test: ## 单元测试(Vitest,后端 + web)
	pnpm run test
	pnpm run test:web

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

AW_ARCH := $(shell uname -m | sed 's/x86_64/x64/')

agent-bundle: build ## 打包执行面一键部署包(collector+proxy bundle+调度器)到 workspace/artifacts
	mkdir -p dist/agent-host workspace/artifacts
	pnpm run bundle:proxy
	cp scripts/aw-dispatch.mjs scripts/enroll-agent.mjs scripts/install-agent-host.sh dist/agent-host/
	@if [ -f collector/dist/bin/aw-node-macos-$(AW_ARCH) ]; then \
		cp collector/dist/bin/aw-node-macos-$(AW_ARCH) dist/agent-host/aw-node-macos-$(AW_ARCH); \
	elif [ -f $(HOME)/.local/bin/aw-node ]; then \
		cp $(HOME)/.local/bin/aw-node dist/agent-host/aw-node-macos-$(AW_ARCH); \
	else echo "缺采集器二进制:先 bun run package 或确认 ~/.local/bin/aw-node"; exit 1; fi
	tar -czf workspace/artifacts/aw-agent-host-darwin-$(AW_ARCH).tar.gz -C dist/agent-host \
		aw-node-macos-$(AW_ARCH) aw-proxy.mjs aw-dispatch.mjs enroll-agent.mjs
	cd workspace/artifacts && shasum -a 256 aw-agent-host-darwin-$(AW_ARCH).tar.gz > SHASUMS256.txt
	cp dist/agent-host/install-agent-host.sh workspace/artifacts/install.sh
	@echo "部署包: workspace/artifacts/(install.sh + tar.gz + SHASUMS256.txt)"
