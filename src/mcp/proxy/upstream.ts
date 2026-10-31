import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PROXY_VERSION, type Upstream } from "./types.js";

export interface UpstreamConfig {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

function childEnv(extra: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return Object.assign(env, extra ?? {});
}

/** stdio 透传接管既有 MCP server(S1 已验证),不重写上游工具 */
export async function connectUpstream(config: UpstreamConfig): Promise<Upstream> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: childEnv(config.env),
    stderr: "inherit",
  });
  const client = new Client({ name: `aw-proxy-${config.id}`, version: PROXY_VERSION });
  await client.connect(transport);
  const cached = (await client.listTools()).tools;

  return {
    id: config.id,
    tools: () => cached,
    callTool: async (name, args) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    close: () => client.close(),
  };
}
