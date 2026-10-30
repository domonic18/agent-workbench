import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireInstanceLock } from "./lock.js";

function lockPath(): string {
  return join(mkdtempSync(join(tmpdir(), "aw-lock-")), "console.lock");
}

describe("acquireInstanceLock", () => {
  it("同一路径只允许一个实例", () => {
    const path = lockPath();
    const lock = acquireInstanceLock(path);

    expect(() => acquireInstanceLock(path)).toThrow(/已有控制台进程在运行/);
    lock.release();
  });

  it("释放后可再次获取", () => {
    const path = lockPath();
    acquireInstanceLock(path).release();

    const again = acquireInstanceLock(path);
    expect(again.path).toBe(path);
    again.release();
  });

  it("pid 已死的陈旧锁会被回收", () => {
    const path = lockPath();
    writeFileSync(path, "999999");

    const lock = acquireInstanceLock(path);
    expect(lock.path).toBe(path);
    lock.release();
  });

  it("进程活着的锁不会被抢", () => {
    const path = lockPath();
    writeFileSync(path, String(process.pid));

    expect(() => acquireInstanceLock(path)).toThrow(/已有控制台进程在运行/);
  });
});
