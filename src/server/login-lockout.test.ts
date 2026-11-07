import { describe, expect, it } from "vitest";
import { LOGIN_LOCKOUT } from "../shared/constants.js";
import { openDatabase, type Db } from "../store/database.js";
import { findLoginFailure } from "../store/repositories/login-lockout.js";
import { createLoginLockoutGuard, type LoginLockoutGuard } from "./login-lockout.js";

async function prepare(): Promise<Db> {
  return openDatabase();
}

async function failTimes(guard: LoginLockoutGuard, source: string): Promise<void> {
  for (let i = 0; i < LOGIN_LOCKOUT.maxFailures; i += 1) {
    await guard.fail(source);
  }
}

describe("登录失败锁定", () => {
  it("未达上限不锁定,达到上限立即锁定", async () => {
    const db = await prepare();
    const guard = createLoginLockoutGuard({ db, now: () => 1_000 });

    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      await guard.fail("ip-a");
    }
    expect(await guard.isLocked("ip-a")).toBe(false);

    await guard.fail("ip-a");
    expect(await guard.isLocked("ip-a")).toBe(true);
    await db.close();
  });

  it("锁定到期后自动清零,重新从一次开始计次", async () => {
    const db = await prepare();
    let clock = 1_000;
    const guard = createLoginLockoutGuard({ db, now: () => clock });
    await failTimes(guard, "ip-a");

    clock += LOGIN_LOCKOUT.lockMs - 1;
    expect(await guard.isLocked("ip-a")).toBe(true);

    clock += 1;
    expect(await guard.isLocked("ip-a")).toBe(false);
    expect(await findLoginFailure(db, "ip-a")).toBeUndefined();

    await guard.fail("ip-a");
    expect((await findLoginFailure(db, "ip-a"))?.failures).toBe(1);
    expect(await guard.isLocked("ip-a")).toBe(false);
    await db.close();
  });

  it("失败计数超过一个窗口未活动则作废,不跨窗口累积", async () => {
    const db = await prepare();
    let clock = 1_000;
    const guard = createLoginLockoutGuard({ db, now: () => clock });
    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      await guard.fail("ip-a");
    }

    clock += LOGIN_LOCKOUT.lockMs;
    expect(await guard.isLocked("ip-a")).toBe(false);
    expect(await findLoginFailure(db, "ip-a")).toBeUndefined();

    await guard.fail("ip-a");
    expect((await findLoginFailure(db, "ip-a"))?.failures).toBe(1);
    expect(await guard.isLocked("ip-a")).toBe(false);
    await db.close();
  });

  it("登录成功清零失败计数", async () => {
    const db = await prepare();
    const guard = createLoginLockoutGuard({ db, now: () => 1_000 });

    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      await guard.fail("ip-a");
    }
    await guard.succeed("ip-a");
    expect(await findLoginFailure(db, "ip-a")).toBeUndefined();

    await guard.fail("ip-a");
    expect(await guard.isLocked("ip-a")).toBe(false);
    await db.close();
  });

  it("只锁定失败来源,其他来源不受影响", async () => {
    const db = await prepare();
    const guard = createLoginLockoutGuard({ db, now: () => 1_000 });
    await failTimes(guard, "ip-a");

    expect(await guard.isLocked("ip-a")).toBe(true);
    expect(await guard.isLocked("ip-b")).toBe(false);
    await db.close();
  });

  it("计数落库,新实例(重启)仍沿用锁定", async () => {
    const db = await prepare();
    await failTimes(createLoginLockoutGuard({ db, now: () => 1_000 }), "ip-a");

    const restarted = createLoginLockoutGuard({ db, now: () => 1_000 });
    expect(await restarted.isLocked("ip-a")).toBe(true);
    await db.close();
  });
});
