# src/application - 应用服务层

## 职责

- 编排领域服务与适配器,定义事务边界内的业务用例。
- 不依赖 HTTP / Fastify 类型,可被路由与后台任务复用。
- 当服务需要同时引用 `src/domain/` 与 `src/mcp/`、`src/adapters/` 等适配器层,
  且放入 `src/domain/` 会产生循环依赖时,优先放此处。

## 当前服务

- `mcp-tool-service.ts` - 控制台 /mcp 工具调用的判定、审计落库与执行编排。

## 依赖方向

`src/server/` → `src/application/` → `src/domain/` + `src/store/` + `src/adapters/`/`src/mcp/`
