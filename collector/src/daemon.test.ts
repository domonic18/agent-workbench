import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAttributionIndex } from "./attribution.js";
import type { CollectorConfig } from "./config.js";
import { classifyStream, createDaemon, listSessionFiles } from "./daemon.js";
import type { BatchRequest, ConsoleClient } from "./http.js";
import { createLogger } from "./log.js";

const UUID = "11111111-2222-3333-4444-555555555555";
const AT = "2026-10-29T06:20:06.481Z";

class FakeClient implements ConsoleClient {
  batches: BatchRequest[] = [];

  async postBatch(request: BatchRequest): Promise<{ acked_seq: number }> {
    this.batches.push(request);
    return { acked_seq: request.batch.at(-1)?.seq ?? 0 };
  }

  async postHeartbeat(): Promise<{ ok: boolean; projects: string[] }> {
    return { ok: true, projects: ["proj"] };
  }

  async getProjects(): Promise<string[]> {
    return ["proj"];
  }

  async healthz(): Promise<boolean> {
    return true;
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
    pollMs: 1_000,
    heartbeatMs: 60_000,
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
});
