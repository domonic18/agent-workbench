import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createUsageResolver } from "../../domain/usage/state.js";
import { createConsoleGateway } from "../../mcp/console-gateway.js";
import type { ConsoleTool } from "../../mcp/console-shared.js";
import { handleConsoleMcp } from "../../mcp/console-server.js";
import type { Db } from "../../store/database.js";
import type { AgentRecord } from "../../store/repositories/agent.js";
import { MCP_ACCESS } from "../../shared/constants.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";

export interface McpRoutesOptions {
  db: Db;
  /** 工具注册表;由组合根构造一次,/mcp 与 Agent 手册共用 */
  tools: readonly ConsoleTool[];
  now?: () => number;
}

// 无状态实现没有 SSE 通道:GET / DELETE 一律 405,只留 POST
async function methodNotAllowed(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return reply
    .code(405)
    .header("allow", "POST")
    .send({ error: { code: "METHOD_NOT_ALLOWED", message: `${MCP_ACCESS.path} 仅接受 POST` } });
}

/**
 * 远程 Streamable HTTP MCP(arch01 §5.2):仅控制台自有控制工具,Agent Bearer 鉴权,
 * 判定与审计在控制台应用服务内执行。无状态实现不落会话。
 */
export function registerMcpRoutes(app: FastifyInstance, options: McpRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const usageResolver = createUsageResolver({ now });
  const gateway = createConsoleGateway({
    db,
    tools: [...options.tools],
    now,
    log: app.log,
    resolveUsage: (agentId: string) => usageResolver.resolve(db, agentId),
  });
  const auth = requireAgentAuth(db);

  app.post(MCP_ACCESS.path, { preHandler: auth }, async (request, reply) => {
    const agent = request.agent as AgentRecord;
    reply.hijack();
    await handleConsoleMcp(gateway, agent, request.raw, reply.raw, request.body);
  });

  app.get(MCP_ACCESS.path, methodNotAllowed);
  app.delete(MCP_ACCESS.path, methodNotAllowed);
}
