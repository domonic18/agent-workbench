import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireLock, LockHeldError } from "./lock.js";

const dirs: string[] = [];

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-lock-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("acquireLock", () => {
  it("首次拿锁成功并写入 pid,释放后可再次拿锁", () => {
    const dir = newDir();
    const lock = acquireLock(dir, { pid: 101 });
    expect(readFileSync(join(dir, "aw-node.lock"), "utf8")).toBe("101");
    lock.release();
    expect(existsSync(join(dir, "aw-node.lock"))).toBe(false);

    const again = acquireLock(dir, { pid: 102 });
    expect(readFileSync(join(dir, "aw-node.lock"), "utf8")).toBe("102");
    again.release();
  });

  it("持有进程存活时第二个实例被拒绝", () => {
    const dir = newDir();
    acquireLock(dir, { pid: 201, isAlive: () => true });
    expect(() => acquireLock(dir, { pid: 202, isAlive: () => true })).toThrow(LockHeldError);
    expect(() => acquireLock(dir, { pid: 202, isAlive: () => true })).toThrow(/pid 201/);
  });

  it("残留锁文件在持有进程死后被接管", () => {
    const dir = newDir();
    writeFileSync(join(dir, "aw-node.lock"), "999");
    const lock = acquireLock(dir, { pid: 301, isAlive: () => false });
    expect(readFileSync(join(dir, "aw-node.lock"), "utf8")).toBe("301");
    lock.release();
  });

  it("同 pid 重复拿锁幂等(同进程内重入)", () => {
    const dir = newDir();
    const first = acquireLock(dir, { pid: 401, isAlive: () => true });
    const second = acquireLock(dir, { pid: 401, isAlive: () => true });
    second.release();
    first.release();
    expect(existsSync(join(dir, "aw-node.lock"))).toBe(false);
  });

  it("非法内容的锁文件视为残留可接管", () => {
    const dir = newDir();
    writeFileSync(join(dir, "aw-node.lock"), "not-a-pid");
    const lock = acquireLock(dir, { pid: 501, isAlive: () => true });
    expect(readFileSync(join(dir, "aw-node.lock"), "utf8")).toBe("501");
    lock.release();
  });

  it("release 不误删他人锁", () => {
    const dir = newDir();
    const lock = acquireLock(dir, { pid: 601 });
    writeFileSync(join(dir, "aw-node.lock"), "602");
    lock.release();
    expect(readFileSync(join(dir, "aw-node.lock"), "utf8")).toBe("602");
  });
});
