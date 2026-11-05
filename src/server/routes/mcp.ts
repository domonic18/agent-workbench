import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createA2aService } from "../../domain/a2a/service.js";
import type { A2aService } from "../../domain/a2a/types.js";
import { createTaskService } from "../../domain/task/service.js";
import { createIngestService } from "../../domain/work/ingest-service.js";
import { createWorkerService } from "../../domain/work/worker-service.js";
import { createConsoleGateway } from "../../mcp/console-gateway.js";
import { createConsoleTools } from "../../mcp/console-tools.js";
import { handleConsoleMcp } from "../../mcp/console-server.js";
import type { Db } from "../../store/database.js";
import type { AgentRecord } from "../../store/repositories/identity.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";

export interface McpRoutesOptions {
  db: Db;
  /** 知识目录,kb_write 的 Markdown 真相源 */
  knowledgeDir: string;
  /** 复用启动方的 A2A 实例;缺省按 db 新建 */
  a2a?: A2aService;
  /** 协作播报群;留空则不入队播报 */
  collabChatId?: string;
  now?: () => number;
}

// 无状态实现没有 SSE 通道:GET / DELETE 一律 405,只留 POST
async function methodNotAllowed(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return reply
    .code(405)
    .header("allow", "POST")
    .send({ error: { code: "METHOD_NOT_ALLOWED", message: "/mcp 仅接受 POST" } });
}

/**
 * 远程 Streamable HTTP MCP(arch01 §5.2):仅控制台自有控制工具,Agent Bearer 鉴权,
 * 判定与审计在控制台应用服务内执行。无状态实现不落会话。
 */
export function registerMcpRoutes(app: FastifyInstance, options: McpRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const tasks = createTaskService({ db, now });
  const a2a = options.a2a ?? createA2aService({ db, now });
  const collab =
    options.collabChatId === undefined ? {} : { collabChatId: options.collabChatId };
  const workers = createWorkerService({ db, now, ...collab });
  const ingest = createIngestService({ db, now, ...collab }).ingest;
  const tools = createConsoleTools({
    db,
    tasks,
    a2a,
    workers,
    ingest,
    now,
    knowledgeDir: options.knowledgeDir,
    announce: {
      db,
      ...(options.collabChatId === undefined ? {} : { chatId: options.collabChatId }),
      now,
    },
  });
  const gateway = createConsoleGateway({ db, tools, now, log: app.log });
  const auth = requireAgentAuth(db);

  app.post("/mcp", { preHandler: auth }, async (request, reply) => {
    const agent = request.agent as AgentRecord;
    reply.hijack();
    await handleConsoleMcp(gateway, agent, request.raw, reply.raw, request.body);
  });

  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);
}
