import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Gateway } from "./gateway.js";
import { PROXY_VERSION } from "./types.js";

/** 模型与工具之间的唯一必经点:所有 tools/call 先过 gateway 的 decide() */
export function createProxyServer(gateway: Gateway): Server {
  const server = new Server(
    { name: "agent-workbench-proxy", version: PROXY_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: gateway.listTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    gateway.callTool(request.params.name, request.params.arguments ?? {}),
  );

  return server;
}
