import { MCP_ACCESS } from "@shared/constants.js";

/**
 * 通用 MCP 客户端配置:手工接入与自助接入两处共用一份,
 * 免得客户端配置形状只改一处。
 */
export function mcpServersSnippet(endpoint: string, authorization: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "aw-console": {
          type: "http",
          url: endpoint,
          headers: { [MCP_ACCESS.authHeader]: authorization },
        },
      },
    },
    null,
    2,
  );
}
