import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectorConfig } from "./config.js";
import { ensureStream, pruneStreams } from "./scan.js";
import { emptyState, streamIdFor, streamsBySession } from "./state.js";
import type { SessionFile } from "./sessions.js";

const SESSION = "22222222-2222-4222-8222-222222222222";

function config(): CollectorConfig {
  return {
    ingestUrl: "http://console",
    baseUrl: "http://console",
    collectorId: "m-test",
    secret: "s",
    claudeDir: "/tmp",
    ccConnectDir: "/tmp",
    stateDir: "/tmp",
    registeredProjects: new Set<string>(),
    pollMs: 1_000,
    batchMax: 100,
    backfill: "none",
    spoolMaxBytes: 1024 * 1024,
    requestTimeoutMs: 1_000,
    collectorVersion: "test",
  } as unknown as CollectorConfig;
}

function file(path: string): SessionFile {
  return { sessionId: SESSION, path };
}

describe("扫描断点键控", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-scan-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("同一会话 uuid 的两份副本各占一条断点,互不顶替", () => {
    const copyA = join(dir, "a.jsonl");
    const copyB = join(dir, "b.jsonl");
    writeFileSync(copyA, "x".repeat(100));
    writeFileSync(copyB, "y".repeat(200));
    const state = emptyState();
    const cfg = config();

    const a = ensureStream(file(copyA), state, cfg, () => 1);
    const b = ensureStream(file(copyB), state, cfg, () => 2);

    // 各自键控、各自从文件末尾起步
    expect(a.path).toBe(copyA);
    expect(a.offset).toBe(100);
    expect(b.path).toBe(copyB);
    expect(b.offset).toBe(200);
    // 但流 id 相同:副本内容重叠部分由服务端按 (流, seq) 去重
    expect(streamIdFor(a.sessionId, a.epoch)).toBe(streamIdFor(b.sessionId, b.epoch));

    // 副本 B 出现不会动副本 A 的断点(v1 的 bug:按 sessionId 键控会覆盖 path 并触发重读)
    const aAgain = ensureStream(file(copyA), state, cfg, () => 3);
    expect(aAgain).toBe(a);
    expect(aAgain.offset).toBe(100);
  });

  it("pruneStreams 清掉文件已消失的条目", () => {
    const live = join(dir, "live.jsonl");
    writeFileSync(live, "x");
    const state = emptyState();
    const cfg = config();
    ensureStream(file(live), state, cfg, () => 1);
    ensureStream(file(join(dir, "gone.jsonl")), state, cfg, () => 1);

    const removed = pruneStreams(state, new Set([live]));

    expect(removed).toBe(1);
    expect(Object.keys(state.streams)).toEqual([live]);
  });

  it("streamsBySession 能找回同一 uuid 的全部副本条目(推送回执按 sessionId 定位)", () => {
    const copyA = join(dir, "a.jsonl");
    const copyB = join(dir, "b.jsonl");
    writeFileSync(copyA, "x");
    writeFileSync(copyB, "x");
    const state = emptyState();
    const cfg = config();
    ensureStream(file(copyA), state, cfg, () => 1);
    ensureStream(file(copyB), state, cfg, () => 2);

    const matches = streamsBySession(state, SESSION);

    expect(matches.map((stream) => stream.path).sort()).toEqual([copyA, copyB].sort());
    // 回执与错误标记要对每份副本生效:共用流 id,ack 同步推进
    for (const stream of matches) {
      stream.ackedSeq = 42;
    }
    expect(state.streams[copyA]?.ackedSeq).toBe(42);
    expect(state.streams[copyB]?.ackedSeq).toBe(42);
    expect(streamsBySession(state, "not-exist")).toEqual([]);
  });
});
