import { mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
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
    writeFileSync(path, String(process.ppid));

    expect(() => acquireInstanceLock(path)).toThrow(/已有控制台进程在运行/);
  });

  it("同主机且 pid 存活时拒绝启动", () => {
    const path = lockPath();
    writeFileSync(path, `${hostname()}\n${process.ppid}`);

    expect(() => acquireInstanceLock(path)).toThrow(/已有控制台进程在运行/);
  });

  it("锁内 pid 等于自身时按陈旧锁回收", () => {
    const path = lockPath();
    // 容器内新旧进程同为 pid 1,同一容器重启后锁会保留到这个分支
    writeFileSync(path, `${hostname()}\n${process.pid}`);

    const lock = acquireInstanceLock(path);
    expect(lock.path).toBe(path);
    lock.release();
  });

  it("容器重建后同 pid 的旧锁会被回收", () => {
    const path = lockPath();
    // 旧容器恒为 pid 1,新容器也是 pid 1;主机名不同即说明不是同一实例
    writeFileSync(path, `previous-container\n${process.pid}`);

    const lock = acquireInstanceLock(path);
    expect(lock.path).toBe(path);
    lock.release();
  });
});
