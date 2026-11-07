import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Spool, type SpoolEntry } from "./spool.js";

function entry(seq: number, streamId = "claude-session:abc"): SpoolEntry {
  return {
    stream_id: streamId,
    session_id: "abc",
    project: "pa",
    seq,
    inode: 1,
    offset: seq * 100,
    kind: "assistant_message",
    occurred_at: 1_000 + seq,
    payload: { text: "x" },
  };
}

describe("spool", () => {
  let dir: string;
  let spool: Spool;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-spool-"));
    spool = new Spool(dir, 512 * 1024 * 1024);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("落盘后可重载,ACK 前不丢", () => {
    expect(spool.append(entry(100))).toBe(true);
    expect(spool.append(entry(200))).toBe(true);
    expect(spool.append(entry(200))).toBe(false);

    const reloaded = new Spool(dir, 512 * 1024 * 1024);
    reloaded.load();
    expect(reloaded.pending("claude-session:abc").map((item) => item.seq)).toEqual([100, 200]);
  });

  it("ACK 后删除已确认条目并重写文件", () => {
    spool.append(entry(100));
    spool.append(entry(200));
    expect(spool.ack("claude-session:abc", 100)).toBe(1);

    const reloaded = new Spool(dir, 512 * 1024 * 1024);
    reloaded.load();
    expect(reloaded.pending("claude-session:abc").map((item) => item.seq)).toEqual([200]);
  });

  it("超出上限时丢最旧的条目", () => {
    const tiny = new Spool(dir, 400);
    for (let seq = 1; seq <= 6; seq += 1) {
      tiny.append(entry(seq * 100));
    }
    const before = tiny.pendingBytes();
    const dropped = tiny.enforceLimit();
    expect(dropped).toBeGreaterThan(0);
    expect(tiny.pendingBytes()).toBeLessThan(before);
    expect(tiny.pendingBytes()).toBeLessThanOrEqual(400);
  });
});
