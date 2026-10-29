.PHONY: install dev check test

# 常用命令统一入口;依赖 package.json 就绪后生效

install: ## 安装依赖
	npm install

dev: ## 启动控制台(开发模式)
	npm run dev

check: ## 类型检查 + lint + 测试
	npm run check

test: ## 运行测试
	npm run test
