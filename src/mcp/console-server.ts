import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AgentRecord } from "../store/repositories/identity.js";
import type { ConsoleGateway } from "./console-gateway.js";
import { CONSOLE_MCP_VERSION } from "./console-shared.js";

/**
 * 无状态 Streamable HTTP(arch01 §5.2):每个 POST 新建 Server + transport,不落会话;
 * Agent Bearer 已在路由 preHandler 验明,身份随参数传入,不经模型自述。
 * 所有 tools/call 先过 gateway 的 decide() 与审计落库。
 */
export async function handleConsoleMcp(
  gateway: ConsoleGateway,
  agent: AgentRecord,
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody: unknown,
): Promise<void> {
  const server = new Server(
    { name: "agent-workbench-console", version: CONSOLE_MCP_VERSION },
    { capabilities: { tools: {} } },
  );
  // 无会话模式:省略 sessionIdGenerator 即 stateless(05 §5.2 无状态实现,不落会话)
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: gateway.listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    gateway.callTool(agent, request.params.name, request.params.arguments ?? {}),
  );

  res.on("close", () => {
    void server.close().catch(() => undefined);
    void transport.close().catch(() => undefined);
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
