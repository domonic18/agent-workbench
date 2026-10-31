import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { RunContext } from "../../domain/capability/gate.js";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { insertToolCallLog } from "../../store/repositories/tool-call-log.js";
import type { NewToolCallLog } from "../../store/repositories/tool-call-log.js";
import { createGateway, exposeToolName } from "./gateway.js";
import type { Upstream } from "./types.js";

interface FakeUpstream extends Upstream {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

function fakeUpstream(id: string, toolNames: readonly string[]): FakeUpstream {
  const calls: FakeUpstream["calls"] = [];
  const tools = toolNames.map(
    (name): Tool => ({ name, description: name, inputSchema: { type: "object" } }),
  );
  return {
    id,
    calls,
    tools: () => tools,
    callTool: async (name, args) => {
      calls.push({ name, args });
      return { content: [{ type: "text", text: `ok:${name}` }] };
    },
    close: async () => undefined,
  };
}

function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run_1",
    agentId: "agt_1",
    taskId: "T-1",
    workspaceRoot: "/workspace",
    usage: { kind: "unlimited" },
    grants: [],
    ...overrides,
  };
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first !== undefined && first.type === "text" ? first.text : "";
}

function setup(toolNames: readonly string[] = ["read", "exec"]) {
  const upstream = fakeUpstream("fs", toolNames);
  const audited: NewToolCallLog[] = [];
  const gateway = createGateway({
    ctx: context(),
    upstreams: [upstream],
    audit: (entry) => audited.push(entry),
    toolMap: { fs: { read: "fs.read" } },
  });
  return { upstream, audited, gateway };
}

describe("gateway", () => {
  it("对外工具名加上上游前缀", () => {
    const { gateway } = setup();
    expect(gateway.listTools().map((tool) => tool.name)).toEqual([
      exposeToolName("fs", "read"),
      exposeToolName("fs", "exec"),
    ]);
  });

  it("L0 放行并转发,审计先落", async () => {
    const { upstream, audited, gateway } = setup();
    const result = await gateway.callTool("fs__read", { path: "/workspace/a.md" });

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe("ok:read");
    expect(upstream.calls).toEqual([{ name: "read", args: { path: "/workspace/a.md" } }]);
    expect(audited[0]).toMatchObject({
      tool: "fs.read",
      level: "L0",
      verdict: "allow",
      taskId: "T-1",
    });
    expect(audited[0]?.argsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("参数哈希与键序无关", async () => {
    const { audited, gateway } = setup();
    await gateway.callTool("fs__read", { b: 1, a: 2 });
    await gateway.callTool("fs__read", { a: 2, b: 1 });
    expect(audited[0]?.argsHash).toBe(audited[1]?.argsHash);
  });

  it("审计写失败即拒绝执行,不触达上游", async () => {
    const upstream = fakeUpstream("fs", ["read"]);
    const gateway = createGateway({
      ctx: context(),
      upstreams: [upstream],
      audit: () => {
        throw new Error("disk full");
      },
      toolMap: { fs: { read: "fs.read" } },
    });

    const result = await gateway.callTool("fs__read", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("审计写入失败");
    expect(upstream.calls).toHaveLength(0);
  });

  it("任务不存在导致审计失败时同样拒绝(真实库外键)", async () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const upstream = fakeUpstream("fs", ["read"]);
    const gateway = createGateway({
      ctx: context({ taskId: "T-missing" }),
      upstreams: [upstream],
      audit: (entry) => insertToolCallLog(db, entry),
      toolMap: { fs: { read: "fs.read" } },
    });

    const result = await gateway.callTool("fs__read", {});
    expect(result.isError).toBe(true);
    expect(upstream.calls).toHaveLength(0);
    db.close();
  });

  it("L2 未接入审批通道时拒绝", async () => {
    const { upstream, audited, gateway } = setup();
    const result = await gateway.callTool("fs__exec", { cmd: "rm -rf /" });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("审批通道不可用");
    expect(upstream.calls).toHaveLength(0);
    expect(audited[0]).toMatchObject({ level: "L2", verdict: "require_approval" });
  });

  it("审批通过后转发", async () => {
    const upstream = fakeUpstream("fs", ["exec"]);
    const audited: NewToolCallLog[] = [];
    const gateway = createGateway({
      ctx: context(),
      upstreams: [upstream],
      audit: (entry) => audited.push(entry),
      approval: async () => true,
    });

    const result = await gateway.callTool("fs__exec", {});
    expect(result.isError).toBeUndefined();
    expect(upstream.calls).toEqual([{ name: "exec", args: {} }]);
  });

  it("审批拒绝或超时都不转发", async () => {
    const upstream = fakeUpstream("fs", ["exec"]);
    const rejected = createGateway({
      ctx: context(),
      upstreams: [upstream],
      audit: () => undefined,
      approval: async () => false,
    });
    expect((await rejected.callTool("fs__exec", {})).isError).toBe(true);
    expect(upstream.calls).toHaveLength(0);

    const timedOut = createGateway({
      ctx: context(),
      upstreams: [upstream],
      audit: () => undefined,
      approval: () => new Promise<boolean>(() => undefined),
      approvalTimeoutMs: 10,
    });
    const result = await timedOut.callTool("fs__exec", {});
    expect(textOf(result)).toContain("审批超时");
    expect(upstream.calls).toHaveLength(0);
  });

  it("命中已生效授权时不等审批,审计带回 capabilityId", async () => {
    const upstream = fakeUpstream("fs", ["exec"]);
    const audited: NewToolCallLog[] = [];
    const gateway = createGateway({
      ctx: context({ grants: [{ tool: "fs.exec", capabilityId: "cap_1" }] }),
      upstreams: [upstream],
      audit: (entry) => audited.push(entry),
      toolMap: { fs: { exec: "fs.exec" } },
    });
    const result = await gateway.callTool("fs__exec", {});
    expect(result.isError).toBeUndefined();
    expect(upstream.calls).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      tool: "fs.exec",
      verdict: "allow",
      capabilityId: "cap_1",
    });
  });

  it("用量超限时即使 L0 也拒绝", async () => {
    const upstream = fakeUpstream("fs", ["read"]);
    const gateway = createGateway({
      ctx: context({ usage: { kind: "metered", usedTokens: 100, dailyLimit: 100 } }),
      upstreams: [upstream],
      audit: () => undefined,
      toolMap: { fs: { read: "fs.read" } },
    });
    const result = await gateway.callTool("fs__read", {});
    expect(result.isError).toBe(true);
    expect(upstream.calls).toHaveLength(0);
  });

  it("未知工具名不转发", async () => {
    const { upstream, gateway } = setup();
    const result = await gateway.callTool("fs__missing", {});
    expect(textOf(result)).toContain("未知工具");
    expect(upstream.calls).toHaveLength(0);
  });
});
