import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState, saveState, STATE_VERSION, streamIdFor, type StreamState } from "./state.js";

function stream(overrides: Partial<StreamState> = {}): StreamState {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    path: "/tmp/a/11111111-1111-4111-8111-111111111111.jsonl",
    project: null,
    status: "unattributed",
    inode: 10,
    offset: 5000,
    epoch: 0,
    ackedSeq: 0,
    lastSeq: 0,
    lastError: null,
    updatedAt: 1,
    ...overrides,
  };
}

describe("采集器状态", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-state-"));
    mkdirSync(join(dir, "state"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("v2 状态原样读回,不算迁移", () => {
    const state = { version: 2 as const, streams: { "/tmp/a": stream() } };
    saveState(dir, state);

    const loaded = loadState(dir);

    expect(loaded.migrated).toBe(false);
    expect(loaded.state.streams["/tmp/a"]?.offset).toBe(5000);
  });

  it("v1 状态迁移:键换成物理路径,epoch 归零", () => {
    const v1 = {
      version: 1,
      streams: {
        // 键是 sessionId;路径是副本 A,epoch 已被顶到 54642
        "11111111-1111-4111-8111-111111111111": stream({ epoch: 54_642 }),
      },
    };
    writeFileSync(join(dir, "state", "streams.json"), JSON.stringify(v1));

    const loaded = loadState(dir);

    expect(loaded.migrated).toBe(true);
    expect(Object.keys(loaded.state.streams)).toEqual([
      "/tmp/a/11111111-1111-4111-8111-111111111111.jsonl",
    ]);
    expect(loaded.state.version).toBe(STATE_VERSION);
    // 断点保留(继续从原偏移读),epoch 归零(流 id 回到无后缀形态)
    expect(loaded.state.streams["/tmp/a/11111111-1111-4111-8111-111111111111.jsonl"]).toMatchObject({
      offset: 5000,
      epoch: 0,
    });
    expect(streamIdFor("s", 0)).toBe("claude-session:s");
  });

  it("损坏的状态文件从零开始,不清 spool", () => {
    writeFileSync(join(dir, "state", "streams.json"), "{broken");

    const loaded = loadState(dir);

    expect(loaded.migrated).toBe(false);
    expect(loaded.state.streams).toEqual({});
  });

  it("没有状态文件(首次安装)从零开始", () => {
    const loaded = loadState(dir);

    expect(loaded.migrated).toBe(false);
    expect(loaded.state.streams).toEqual({});
  });
});
