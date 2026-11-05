import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  createMcpToolService,
  type McpToolServiceDeps,
} from "../application/mcp-tool-service.js";

export interface ConsoleGateway {
  listTools(): Tool[];
  callTool(
    agent: import("../store/repositories/identity.js").AgentRecord,
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult>;
}

/**
 * 控制台 /mcp 协议适配入口(05 §6.3):把工具判定、审计与执行编排交给应用服务,
 * 本层只负责 list/call 的协议形状转换。
 */
export function createConsoleGateway(deps: McpToolServiceDeps): ConsoleGateway {
  const service = createMcpToolService(deps);
  return {
    listTools(): Tool[] {
      return service.listTools() as Tool[];
    },
    callTool(agent, name, args) {
      return service.callTool(agent, name, args);
    },
  };
}
