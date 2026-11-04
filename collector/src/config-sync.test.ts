import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ConfigAckRequest,
  DeliveredAgentConfig,
  PullConfigResponse,
} from "../../src/shared/aw-node-wire.js";
import {
  applyManagedMcp,
  loadConfigSyncState,
  MCP_SERVER_NAME,
  syncConfigOnce,
} from "./config-sync.js";
import type { ConsoleClient } from "./http.js";

const dirs: string[] = [];

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-cfg-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface ClaudeJsonDoc {
  userID?: string;
  projects: Record<string, { mcpServers?: Record<string, unknown>; history?: string[] }>;
}

function readDoc(path: string): ClaudeJsonDoc {
  return JSON.parse(readFileSync(path, "utf8")) as ClaudeJsonDoc;
}

function agent(
  overrides: Omit<Partial<DeliveredAgentConfig>, "secret"> & { secret?: string | undefined },
): DeliveredAgentConfig {
  const { secret: _secret, ...rest } = overrides;
  const merged: DeliveredAgentConfig = {
    agent_id: "agt_a",
    key: "p-a",
    project: "proj-a",
    config_version: 1,
    rotated: true,
    mcp: { endpoint: "/mcp" },
    ...rest,
  };
  if (overrides.secret !== undefined) {
    merged.secret = overrides.secret;
  } else if (merged.rotated) {
    merged.secret = "sec-a";
  }
  return merged;
}

function fakeClient(
  pulled: PullConfigResponse,
  onAck?: () => void,
): ConsoleClient & { ackCalls: ConfigAckRequest["agents"][] } {
  const ackCalls: ConfigAckRequest["agents"][] = [];
  return {
    ackCalls,
    async postBatch() {
      throw new Error("unused");
    },
    async postHeartbeat() {
      return { ok: true, projects: [] };
    },
    async getProjects() {
      return [];
    },
    async healthz() {
      return true;
    },
    async postDiscovery() {
      return { ok: true, received_at: 1 };
    },
    async pullConfig() {
      return pulled;
    },
    async ackConfig(acks) {
      ackCalls.push(acks);
      onAck?.();
      return { ok: true, config_status: "effective", acked: acks.map((a) => a.agent_id) };
    },
  };
}

describe("applyManagedMcp", () => {
  it("空文件场景:创建 projects[cwd].mcpServers.aw-console,权限 0600,原子落盘", () => {
    const dir = newDir();
    const path = join(dir, "claude.json");
    applyManagedMcp(path, { cwd: "/w/p1", url: "https://aw.example.com/mcp", bearer: "agt_1.s1" });

    expect(readDoc(path).projects["/w/p1"]!.mcpServers![MCP_SERVER_NAME]).toEqual({
      type: "http",
      url: "https://aw.example.com/mcp",
      headers: { authorization: "Bearer agt_1.s1" },
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("已有文件:备份 .aw-backup,保留无关内容与原权限,只覆盖 aw-console 条目", () => {
    const dir = newDir();
    const path = join(dir, "claude.json");
    writeFileSync(
      path,
      JSON.stringify({
        userID: "u-1",
        projects: {
          "/w/p1": { mcpServers: { other: { type: "stdio", command: "x" } } },
          "/w/p2": { history: ["a"] },
        },
      }),
      { mode: 0o644 },
    );

    applyManagedMcp(path, { cwd: "/w/p1", url: "https://aw/mcp", bearer: "agt_2.s2" });
    applyManagedMcp(path, { cwd: "/w/p1", url: "https://aw/mcp", bearer: "agt_2.s3" });

    const doc = readDoc(path);
    expect(doc.userID).toBe("u-1");
    expect(doc.projects["/w/p1"]!.mcpServers!.other).toEqual({ type: "stdio", command: "x" });
    expect(doc.projects["/w/p1"]!.mcpServers![MCP_SERVER_NAME]).toMatchObject({
      headers: { authorization: "Bearer agt_2.s3" },
    });
    expect(doc.projects["/w/p2"]!.history).toEqual(["a"]);
    // 备份保留的是最后一次改写前内容
    const backup = readDoc(`${path}.aw-backup`);
    expect(backup.projects["/w/p1"]!.mcpServers![MCP_SERVER_NAME]).toMatchObject({
      headers: { authorization: "Bearer agt_2.s2" },
    });
    expect(statSync(path).mode & 0o777).toBe(0o644);
  });

  it("原文件损坏时拒绝改写", () => {
    const dir = newDir();
    const path = join(dir, "claude.json");
    writeFileSync(path, "{broken");
    expect(() => applyManagedMcp(path, { cwd: "/w", url: "https://aw/mcp", bearer: "b" })).toThrow(
      /解析失败/,
    );
  });
});

describe("syncConfigOnce", () => {
  it("轮换者写入并 ACK,已生效者跳过;状态与版本落 config-state", async () => {
    const dir = newDir();
    const claudeJson = join(dir, "claude.json");
    const client = fakeClient({
      config_status: "delivered",
      agents: [
        agent({ config_version: 3 }),
        agent({
          agent_id: "agt_b",
          key: "p-b",
          project: "proj-b",
          config_version: 1,
          rotated: false,
          secret: undefined,
        }),
      ],
    });

    const summary = await syncConfigOnce({
      client,
      stateDir: dir,
      baseUrl: "https://aw.example.com",
      claudeJsonPath: claudeJson,
      cwdByProject: new Map([["proj-a", "/w/a"]]),
    });

    expect(summary).toMatchObject({ status: "delivered", rotated: 1, applied: 1, acked: true });
    expect(summary.skippedProjects).toEqual([]);
    expect(client.ackCalls).toEqual([[{ agent_id: "agt_a", config_version: 3 }]]);
    expect(readDoc(claudeJson).projects["/w/a"]!.mcpServers![MCP_SERVER_NAME]).toMatchObject({
      headers: { authorization: "Bearer agt_a.sec-a" },
    });

    const state = loadConfigSyncState(dir);
    expect(state.agents.agt_a).toEqual({ version: 3, project: "proj-a", key: "p-a", cwd: "/w/a" });
    expect(state.lastSyncAt).not.toBeNull();
  });

  it("发现结果无 cwd 的轮换者:不写入、不 ACK、列入 skipped", async () => {
    const dir = newDir();
    const client = fakeClient({
      config_status: "delivered",
      agents: [agent({ project: "ghost" })],
    });
    const summary = await syncConfigOnce({
      client,
      stateDir: dir,
      baseUrl: "https://aw",
      claudeJsonPath: join(dir, "claude.json"),
      cwdByProject: new Map(),
    });
    expect(summary.applied).toBe(0);
    expect(summary.skippedProjects).toEqual(["ghost"]);
    expect(client.ackCalls).toEqual([]);
  });

  it("ACK 失败不阻塞:写入与状态保留,下一轮重试(服务端轮换语义兜底)", async () => {
    const dir = newDir();
    const client = fakeClient({ config_status: "delivered", agents: [agent({})] }, () => {
      throw new Error("HTTP 409");
    });
    const summary = await syncConfigOnce({
      client,
      stateDir: dir,
      baseUrl: "https://aw",
      claudeJsonPath: join(dir, "claude.json"),
      cwdByProject: new Map([["proj-a", "/w/a"]]),
    });
    expect(summary.acked).toBe(false);
    expect(summary.applied).toBe(1);
    expect(loadConfigSyncState(dir).agents.agt_a?.version).toBe(1);
  });

  it("全部已生效时无写入无 ACK", async () => {
    const dir = newDir();
    const client = fakeClient({
      config_status: "effective",
      agents: [agent({ rotated: false, secret: undefined, config_version: 2 })],
    });
    const summary = await syncConfigOnce({
      client,
      stateDir: dir,
      baseUrl: "https://aw",
      claudeJsonPath: join(dir, "claude.json"),
      cwdByProject: new Map([["proj-a", "/w/a"]]),
    });
    expect(summary).toMatchObject({ status: "effective", applied: 0, acked: false });
    expect(client.ackCalls).toEqual([]);
  });
});
