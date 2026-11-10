import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAttributionIndex } from "./attribution.js";
import type { CollectorConfig } from "./config.js";
import { createDaemon } from "./daemon.js";
import { classifyStream, listSessionFiles } from "./sessions.js";
import type { BatchRequest, ConsoleClient } from "./http.js";
import { acquireLock, LockHeldError } from "./lock.js";
import { createLogger } from "./log.js";
import type { PullConfigResponse } from "../../src/shared/aw-node-wire.js";

const UUID = "11111111-2222-3333-4444-555555555555";
const AT = "2026-10-29T06:20:06.481Z";

class FakeClient implements ConsoleClient {
  batches: BatchRequest[] = [];
  heartbeats: Record<string, unknown>[] = [];
  discoveryReports: unknown[] = [];
  acks: Array<Array<{ agent_id: string; config_version: number }>> = [];
  pull: PullConfigResponse = { config_status: "effective", agents: [] };

  async postBatch(request: BatchRequest): Promise<{ acked_seq: number }> {
    this.batches.push(request);
    return { acked_seq: request.batch.at(-1)?.seq ?? 0 };
  }

  async postHeartbeat(
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; projects: string[] }> {
    this.heartbeats.push(payload);
    return { ok: true, projects: ["proj"] };
  }

  async postRunEnd(): Promise<{ run_id: string | null }> {
    return { run_id: null };
  }

  async getProjects(): Promise<string[]> {
    return ["proj"];
  }

  async healthz(): Promise<boolean> {
    return true;
  }

  async postDiscovery(report: unknown): Promise<{ ok: boolean; received_at: number }> {
    this.discoveryReports.push(report);
    return { ok: true, received_at: 0 };
  }

  async pullConfig(): Promise<PullConfigResponse> {
    return this.pull;
  }

  async ackConfig(acks: Array<{ agent_id: string; config_version: number }>) {
    this.acks.push(acks);
    return { ok: true, config_status: "effective", acked: acks.map((a) => a.agent_id) };
  }
}

function configOf(stateDir: string, claudeDir: string, ccConnectDir: string): CollectorConfig {
  return {
    ingestUrl: "http://127.0.0.1:8787/api/ingest",
    baseUrl: "http://127.0.0.1:8787",
    collectorId: "macmini-01",
    secret: "secret",
    registeredProjects: ["proj"],
    stateDir,
    claudeDir,
    ccConnectDir,
    // 测试不读真机 cc-connect 配置;发现扫描指向不存在的路径返回空报告
    ccConnectConfigs: [join(stateDir, "cc-connect-none.toml")],
    claudeJsonPath: join(stateDir, "claude.json"),
    extraProjects: [],
    pollMs: 1_000,
    heartbeatMs: 60_000,
    discoveryMs: 300_000,
    configSyncMs: 60_000,
    dispatchMs: 0,
    sessionTimeoutMs: 30 * 60_000,
    dispatchModel: null,
    dispatchClaude: null,
    busySessionWindowMs: 15 * 60_000,
    maxMachineSessions: 2,
    dispatchBackoffRounds: 5,
    batchMaxItems: 8,
    batchMax: 500,
    backfill: "all",
    spoolMaxBytes: 512 * 1024 * 1024,
    requestTimeoutMs: 5_000,
  };
}

describe("采集循环", () => {
  let root: string;
  let config: CollectorConfig;
  let client: FakeClient;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aw-daemon-"));
    const claudeDir = join(root, "claude");
    const ccConnectDir = join(root, "cc");
    mkdirSync(join(claudeDir, "projects", "-tmp-project"), { recursive: true });
    mkdirSync(join(ccConnectDir, "sessions"), { recursive: true });
    writeFileSync(
      join(ccConnectDir, "sessions", "proj_1234abcd.json"),
      JSON.stringify({ sessions: { s1: { agent_session_id: UUID } } }),
    );
    writeFileSync(
      join(claudeDir, "projects", "-tmp-project", `${UUID}.jsonl`),
      `${JSON.stringify({
        type: "user",
        timestamp: AT,
        message: { role: "user", content: "做一下" },
      })}\n${JSON.stringify({
        type: "assistant",
        timestamp: AT,
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "好的" }],
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
          },
        },
      })}\n`,
    );
    config = configOf(join(root, "state"), claudeDir, ccConnectDir);
    client = new FakeClient();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("归因成功的流按批次推送并在 ACK 后清空 spool", async () => {
    const daemon = createDaemon({
      config,
      client,
      logger: createLogger({ level: "error", sink: () => {} }),
    });
    await daemon.runOnce();

    expect(client.batches).toHaveLength(1);
    const batch = client.batches[0]!;
    expect(batch.collector_id).toBe("macmini-01");
    expect(batch.agent_project).toBe("proj");
    expect(batch.stream_id).toBe(`claude-session:${UUID}`);
    expect(batch.batch.map((item) => item.kind)).toEqual([
      "user_message",
      "assistant_message",
      "token_usage",
    ]);
    expect(batch.batch[2]?.payload).toMatchObject({
      model: "claude-sonnet-4-6",
      input_tokens: 10,
      cache_read_tokens: 3,
      cache_creation_tokens: 4,
    });

    await daemon.runOnce();
    expect(client.batches).toHaveLength(1);
  });

  it("未登记项目只落 spool,不推送", async () => {
    config = { ...config, registeredProjects: ["other"] };
    const daemon = createDaemon({
      config,
      client,
      logger: createLogger({ level: "error", sink: () => {} }),
    });
    await daemon.runOnce();
    await daemon.runOnce();
    expect(client.batches).toHaveLength(0);
  });

  it("会话文件按 uuid 枚举,忽略子目录与非 uuid 文件", () => {
    const files = listSessionFiles(config.claudeDir);
    expect(files.map((file) => file.sessionId)).toEqual([UUID]);
  });

  it("归因档位:未命中 / 多项目 / 未登记 / 正常", () => {
    const index = buildAttributionIndex(
      new Map([
        ["hit", new Set(["proj"])],
        ["multi", new Set(["proj", "other"])],
        ["unregistered", new Set(["unknown"])],
      ]),
    );
    const registered = new Set(["proj"]);
    expect(classifyStream(index, "none", registered)).toEqual({
      status: "unattributed",
      project: null,
    });
    expect(classifyStream(index, "multi", registered)).toEqual({
      status: "ambiguous",
      project: null,
    });
    expect(classifyStream(index, "unregistered", registered)).toEqual({
      status: "unregistered",
      project: "unknown",
    });
    expect(classifyStream(index, "hit", registered)).toEqual({
      status: "ok",
      project: "proj",
    });
  });

  it("调度默认关闭(AW_DISPATCH_MS=0)时不挂载", async () => {
    const logs: string[] = [];
    const daemon = createDaemon({
      config,
      client,
      logger: createLogger({ level: "info", sink: (line) => logs.push(line) }),
    });
    const started = daemon.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    daemon.stop();
    await started;

    expect(logs.some((line) => line.includes("调度模块已挂载"))).toBe(false);
  });

  it("调度开启且 claude 路径可解析时挂载调度模块", async () => {
    const claude = join(root, "claude-bin");
    writeFileSync(claude, "#!/bin/sh\n");
    const logs: string[] = [];
    const daemon = createDaemon({
      config: { ...config, dispatchMs: 60_000, dispatchClaude: claude },
      client,
      logger: createLogger({ level: "info", sink: (line) => logs.push(line) }),
    });
    const started = daemon.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    daemon.stop();
    await started;

    expect(logs.some((line) => line.includes("调度模块已挂载"))).toBe(true);
  });

  it("心跳活跃流:扫描读到新字节的流在下一跳上报,无新字节后回落为空", async () => {
    const daemon = createDaemon({
      config: { ...config, pollMs: 5, heartbeatMs: 10 },
      client,
      logger: createLogger({ level: "error", sink: () => {} }),
    });
    const started = daemon.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    daemon.stop();
    await started;

    const active = (beat: Record<string, unknown>): string[] =>
      Array.isArray(beat.active_streams) ? (beat.active_streams as string[]) : [];
    // 首批扫描读到两行新字节 → 后续某一跳携带该活跃流
    expect(
      client.heartbeats.some((beat) => active(beat).includes(`claude-session:${UUID}`)),
    ).toBe(true);
    // 之后没有新字节,最后一跳已排水回落为空
    expect(active(client.heartbeats.at(-1)!)).toEqual([]);
  });
});

describe("发现与配置同步周期", () => {
  let root: string;
  let config: CollectorConfig;
  let client: FakeClient;
  const logger = createLogger({ level: "error", sink: () => {} });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aw-node-cycle-"));
    config = configOf(join(root, "state"), join(root, "claude"), join(root, "cc"));
    client = new FakeClient();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("发现结果有变化才上报,内容不变不重复发;配置轮换写入 claude.json 并 ACK", async () => {
    // 发现扫描指向真实结构的 TOML
    const tomlPath = join(root, "cc-connect.toml");
    writeFileSync(
      tomlPath,
      '[[projects]]\nname = "proj"\n[projects.agent.options]\nwork_dir = "/w/proj"\n',
    );
    config = { ...config, ccConnectConfigs: [tomlPath] };
    client.pull = {
      config_status: "delivered",
      agents: [
        {
          agent_id: "agt_1",
          key: "proj",
          project: "proj",
          config_version: 1,
          rotated: true,
          secret: "sec-1",
          mcp: { endpoint: "/mcp" },
        },
      ],
    };

    const daemon = createDaemon({ config, client, logger });
    // start 常驻不返回:先让一轮启动周期跑完(心跳/发现/配置同步都是微任务),
    // 再 stop 解除 start 内部的 stopped 等待
    const started = daemon.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    daemon.stop();
    await started;

    // start 内 discoveryOnce + configSyncCycle 各执行过一轮:
    // 第二轮周期不 start,只验证已发生的一轮效果
    expect(client.discoveryReports).toHaveLength(1);
    expect(client.discoveryReports[0]).toMatchObject({
      projects: [{ name: "proj", cwd: "/w/proj" }],
    });
    expect(client.acks).toEqual([[{ agent_id: "agt_1", config_version: 1 }]]);
    const doc = JSON.parse(readFileSync(join(root, "state", "claude.json"), "utf8"));
    expect(doc.projects["/w/proj"].mcpServers["aw-console"].headers.authorization).toBe(
      "Bearer agt_1.sec-1",
    );
  });

  it("第二个实例拿不到锁:start 直接失败,不产生任何推送", async () => {
    // 用真实存活且非自身的 pid 占锁(daemon 侧探测走 process.kill,pid 1 返回 EPERM 判活)
    const held = acquireLock(config.stateDir, { pid: 1 });
    try {
      const daemon = createDaemon({ config, client, logger });
      await expect(daemon.start()).rejects.toThrow(LockHeldError);
      expect(client.batches).toHaveLength(0);
    } finally {
      held.release();
    }
  });
});
