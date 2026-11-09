import { describe, expect, it } from "vitest";
import { LOGIN_LOCKOUT } from "../shared/constants.js";
import { openDatabase, type Db } from "../store/database.js";
import { findLoginFailure } from "../store/repositories/login-lockout.js";
import {
  createLoginLockoutGuard,
  LOGIN_LOCKOUT_BUCKET,
  type LoginLockoutGuard,
} from "./login-lockout.js";

async function prepare(): Promise<Db> {
  return openDatabase();
}

async function failTimes(guard: LoginLockoutGuard): Promise<void> {
  for (let i = 0; i < LOGIN_LOCKOUT.maxFailures; i += 1) {
    await guard.fail();
  }
}

describe("登录失败锁定", () => {
  it("未达上限不锁定,达到上限立即锁定", async () => {
    const db = await prepare();
    const guard = createLoginLockoutGuard({ db, now: () => 1_000 });

    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      await guard.fail();
    }
    expect(await guard.isLocked()).toBe(false);

    await guard.fail();
    expect(await guard.isLocked()).toBe(true);
    await db.close();
  });

  it("锁定到期后自动清零,重新从一次开始计次", async () => {
    const db = await prepare();
    let clock = 1_000;
    const guard = createLoginLockoutGuard({ db, now: () => clock });
    await failTimes(guard);

    clock += LOGIN_LOCKOUT.lockMs - 1;
    expect(await guard.isLocked()).toBe(true);

    clock += 1;
    expect(await guard.isLocked()).toBe(false);
    expect(await findLoginFailure(db, LOGIN_LOCKOUT_BUCKET)).toBeUndefined();

    await guard.fail();
    expect((await findLoginFailure(db, LOGIN_LOCKOUT_BUCKET))?.failures).toBe(1);
    expect(await guard.isLocked()).toBe(false);
    await db.close();
  });

  it("失败计数超过一个窗口未活动则作废,不跨窗口累积", async () => {
    const db = await prepare();
    let clock = 1_000;
    const guard = createLoginLockoutGuard({ db, now: () => clock });
    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      await guard.fail();
    }

    clock += LOGIN_LOCKOUT.lockMs;
    expect(await guard.isLocked()).toBe(false);
    expect(await findLoginFailure(db, LOGIN_LOCKOUT_BUCKET)).toBeUndefined();

    await guard.fail();
    expect((await findLoginFailure(db, LOGIN_LOCKOUT_BUCKET))?.failures).toBe(1);
    expect(await guard.isLocked()).toBe(false);
    await db.close();
  });

  it("登录成功清零失败计数", async () => {
    const db = await prepare();
    const guard = createLoginLockoutGuard({ db, now: () => 1_000 });

    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      await guard.fail();
    }
    await guard.succeed();
    expect(await findLoginFailure(db, LOGIN_LOCKOUT_BUCKET)).toBeUndefined();

    await guard.fail();
    expect(await guard.isLocked()).toBe(false);
    await db.close();
  });

  it("只有一个全局桶:失败计数不按来源分开,换来源也接着算", async () => {
    const db = await prepare();
    const guard = createLoginLockoutGuard({ db, now: () => 1_000 });
    await failTimes(guard);

    expect(await guard.isLocked()).toBe(true);
    expect(await db.get("SELECT COUNT(*) AS n FROM login_failure")).toEqual({ n: 1 });
    expect((await findLoginFailure(db, LOGIN_LOCKOUT_BUCKET))?.failures).toBe(
      LOGIN_LOCKOUT.maxFailures,
    );
    await db.close();
  });

  it("计数落库,新实例(重启)仍沿用锁定", async () => {
    const db = await prepare();
    await failTimes(createLoginLockoutGuard({ db, now: () => 1_000 }));

    const restarted = createLoginLockoutGuard({ db, now: () => 1_000 });
    expect(await restarted.isLocked()).toBe(true);
    await db.close();
  });
});
