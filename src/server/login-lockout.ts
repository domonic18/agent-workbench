import { LOGIN_LOCKOUT } from "../shared/constants.js";
import type { Db } from "../store/database.js";
import {
  clearLoginFailures,
  findLoginFailure,
  upsertLoginFailure,
} from "../store/repositories/login-lockout.js";

export interface LoginLockoutGuard {
  /**
   * 当前是否处于锁定期;锁过期、或失败计数已超出一个窗口未活动时顺手清零,
   * 让「连续失败」只在一个窗口内累积。
   */
  isLocked(source: string): Promise<boolean>;
  fail(source: string): Promise<void>;
  succeed(source: string): Promise<void>;
}

export interface LoginLockoutDeps {
  db: Db;
  now?: () => number;
}

/**
 * 登录失败锁定(01 §3):按来源连续失败计数,达到上限锁 10 分钟。
 * 只作用于登录接口;已登录会话不受影响。计数落库,重启不绕锁。
 */
export function createLoginLockoutGuard(deps: LoginLockoutDeps): LoginLockoutGuard {
  const { db } = deps;
  const now = deps.now ?? Date.now;

  async function isLocked(source: string): Promise<boolean> {
    const row = await findLoginFailure(db, source);
    if (row === undefined) {
      return false;
    }
    const at = now();
    if (row.lockedUntil !== null) {
      if (row.lockedUntil > at) {
        return true;
      }
      await clearLoginFailures(db, source);
      return false;
    }
    if (row.updatedAt + LOGIN_LOCKOUT.lockMs <= at) {
      await clearLoginFailures(db, source);
    }
    return false;
  }

  async function fail(source: string): Promise<void> {
    const at = now();
    const current = await findLoginFailure(db, source);
    const failures = (current?.failures ?? 0) + 1;
    const lockedUntil =
      failures >= LOGIN_LOCKOUT.maxFailures ? at + LOGIN_LOCKOUT.lockMs : null;
    await upsertLoginFailure(db, { source, failures, lockedUntil, updatedAt: at });
  }

  async function succeed(source: string): Promise<void> {
    await clearLoginFailures(db, source);
  }

  return { isLocked, fail, succeed };
}
