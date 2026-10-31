import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { RunContext } from "../../domain/capability/gate.js";
import { createGateway } from "./gateway.js";
import { createProxyServer } from "./server.js";
import type { Upstream } from "./types.js";

const ctx: RunContext = {
  runId: "run_1",
  agentId: "agt_1",
  taskId: "T-1",
  workspaceRoot: "/workspace",
  usage: { kind: "unlimited" },
  grants: [],
};

function fakeUpstream(): Upstream {
  const tools: Tool[] = [{ name: "read", inputSchema: { type: "object" } }];
  return {
    id: "fs",
    tools: () => tools,
    callTool: async (name) => ({ content: [{ type: "text", text: `ok:${name}` }] }),
    close: async () => undefined,
  };
}

describe("MCP proxy 协议层", () => {
  it("经 stdio 协议暴露工具并按闸门转发", async () => {
    const gateway = createGateway({
      ctx,
      upstreams: [fakeUpstream()],
      audit: () => undefined,
      toolMap: { fs: { read: "fs.read" } },
    });
    const server = createProxyServer(gateway);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(["fs__read"]);

    const result = (await client.callTool({ name: "fs__read", arguments: {} })) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBeUndefined();
    const first = result.content[0];
    expect(first !== undefined && first.type === "text" ? first.text : "").toBe("ok:read");

    await client.close();
    await server.close();
  });
});
