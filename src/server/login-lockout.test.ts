import { describe, expect, it } from "vitest";
import { LOGIN_LOCKOUT } from "../shared/constants.js";
import { openDatabase, type Db } from "../store/database.js";
import { runMigrations } from "../store/migrator.js";
import { findLoginFailure } from "../store/repositories/login-lockout.js";
import { createLoginLockoutGuard } from "./login-lockout.js";

function prepare(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

function failTimes(guard: ReturnType<typeof createLoginLockoutGuard>, source: string): void {
  for (let i = 0; i < LOGIN_LOCKOUT.maxFailures; i += 1) {
    guard.fail(source);
  }
}

describe("登录失败锁定", () => {
  it("未达上限不锁定,达到上限立即锁定", () => {
    const db = prepare();
    const guard = createLoginLockoutGuard({ db, now: () => 1_000 });

    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      guard.fail("ip-a");
    }
    expect(guard.isLocked("ip-a")).toBe(false);

    guard.fail("ip-a");
    expect(guard.isLocked("ip-a")).toBe(true);
    db.close();
  });

  it("锁定到期后自动清零,重新从一次开始计次", () => {
    const db = prepare();
    let clock = 1_000;
    const guard = createLoginLockoutGuard({ db, now: () => clock });
    failTimes(guard, "ip-a");

    clock += LOGIN_LOCKOUT.lockMs - 1;
    expect(guard.isLocked("ip-a")).toBe(true);

    clock += 1;
    expect(guard.isLocked("ip-a")).toBe(false);
    expect(findLoginFailure(db, "ip-a")).toBeUndefined();

    guard.fail("ip-a");
    expect(findLoginFailure(db, "ip-a")?.failures).toBe(1);
    expect(guard.isLocked("ip-a")).toBe(false);
    db.close();
  });

  it("失败计数超过一个窗口未活动则作废,不跨窗口累积", () => {
    const db = prepare();
    let clock = 1_000;
    const guard = createLoginLockoutGuard({ db, now: () => clock });
    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      guard.fail("ip-a");
    }

    clock += LOGIN_LOCKOUT.lockMs;
    expect(guard.isLocked("ip-a")).toBe(false);
    expect(findLoginFailure(db, "ip-a")).toBeUndefined();

    guard.fail("ip-a");
    expect(findLoginFailure(db, "ip-a")?.failures).toBe(1);
    expect(guard.isLocked("ip-a")).toBe(false);
    db.close();
  });

  it("登录成功清零失败计数", () => {
    const db = prepare();
    const guard = createLoginLockoutGuard({ db, now: () => 1_000 });

    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      guard.fail("ip-a");
    }
    guard.succeed("ip-a");
    expect(findLoginFailure(db, "ip-a")).toBeUndefined();

    guard.fail("ip-a");
    expect(guard.isLocked("ip-a")).toBe(false);
    db.close();
  });

  it("只锁定失败来源,其他来源不受影响", () => {
    const db = prepare();
    const guard = createLoginLockoutGuard({ db, now: () => 1_000 });
    failTimes(guard, "ip-a");

    expect(guard.isLocked("ip-a")).toBe(true);
    expect(guard.isLocked("ip-b")).toBe(false);
    db.close();
  });

  it("计数落库,新实例(重启)仍沿用锁定", () => {
    const db = prepare();
    failTimes(createLoginLockoutGuard({ db, now: () => 1_000 }), "ip-a");

    const restarted = createLoginLockoutGuard({ db, now: () => 1_000 });
    expect(restarted.isLocked("ip-a")).toBe(true);
    db.close();
  });
});
