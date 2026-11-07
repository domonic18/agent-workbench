import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readNewLines } from "./tailer.js";

describe("断点续读", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-tailer-"));
    file = join(dir, "session.jsonl");
    writeFileSync(file, "one\ntwo\n");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("只消费完整行,半行留在下次", () => {
    const first = readNewLines(file, { inode: 0, offset: 0, epoch: 0 });
    expect(first.lines.map((line) => line.text)).toEqual(["one", "two"]);
    expect(first.offset).toBe(8);
    expect(first.rotated || first.truncated).toBe(false);

    appendFileSync(file, "three");
    const partial = readNewLines(file, {
      inode: first.inode,
      offset: first.offset,
      epoch: first.epoch,
    });
    expect(partial.lines).toEqual([]);
    expect(partial.offset).toBe(8);

    appendFileSync(file, "\nfour\n");
    const rest = readNewLines(file, {
      inode: partial.inode,
      offset: partial.offset,
      epoch: partial.epoch,
    });
    expect(rest.lines.map((line) => line.text)).toEqual(["three", "four"]);
    expect(rest.offset).toBe(19);
  });

  it("文件变短判定截断,offset 归零并推进 epoch", () => {
    const first = readNewLines(file, { inode: 0, offset: 0, epoch: 0 });
    writeFileSync(file, "x\n");
    const result = readNewLines(file, {
      inode: first.inode,
      offset: first.offset,
      epoch: first.epoch,
    });
    expect(result.truncated).toBe(true);
    expect(result.epoch).toBe(first.epoch + 1);
    expect(result.lines.map((line) => line.text)).toEqual(["x"]);
  });

  it("inode 变化判定轮转", () => {
    const first = readNewLines(file, { inode: 0, offset: 0, epoch: 0 });
    renameSync(file, join(dir, "old.jsonl"));
    writeFileSync(file, "fresh\n");
    const result = readNewLines(file, {
      inode: first.inode,
      offset: first.offset,
      epoch: first.epoch,
    });
    expect(result.rotated).toBe(true);
    expect(result.epoch).toBe(first.epoch + 1);
    expect(result.lines.map((line) => line.text)).toEqual(["fresh"]);
  });

  it("文件不存在时原样返回断点", () => {
    const result = readNewLines(join(dir, "missing.jsonl"), {
      inode: 42,
      offset: 7,
      epoch: 1,
    });
    expect(result.missing).toBe(true);
    expect(result.inode).toBe(42);
    expect(result.offset).toBe(7);
    expect(result.epoch).toBe(1);
  });
});
