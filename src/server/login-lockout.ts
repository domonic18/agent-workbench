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
  isLocked(): Promise<boolean>;
  fail(): Promise<void>;
  succeed(): Promise<void>;
}

export interface LoginLockoutDeps {
  db: Db;
  now?: () => number;
}

/**
 * 单一全局桶:公网入口(隧道/反代)把所有外部来源收敛到同一个出口 IP,
 * 按来源分桶等于没分——真按 IP 分,换个出口就能重新开始猜。
 * 索性只留一个桶,口令猜测定次全局封顶。
 *
 * 代价是攻击者能锁住所有人的登录入口(可用性 DoS);换取的是猜测定次有硬上限。
 * 已登录的会话不受影响,锁定只挡口令校验这一步。
 */
export const LOGIN_LOCKOUT_BUCKET = "global";

/**
 * 口令校验失败锁定(01 §3):连续失败计数达到上限锁 10 分钟。
 * 作用于登录与改口令两步的口令校验;计数落库,重启不绕锁。
 */
export function createLoginLockoutGuard(deps: LoginLockoutDeps): LoginLockoutGuard {
  const { db } = deps;
  const now = deps.now ?? Date.now;

  async function isLocked(): Promise<boolean> {
    const row = await findLoginFailure(db, LOGIN_LOCKOUT_BUCKET);
    if (row === undefined) {
      return false;
    }
    const at = now();
    if (row.lockedUntil !== null) {
      if (row.lockedUntil > at) {
        return true;
      }
      await clearLoginFailures(db, LOGIN_LOCKOUT_BUCKET);
      return false;
    }
    if (row.updatedAt + LOGIN_LOCKOUT.lockMs <= at) {
      await clearLoginFailures(db, LOGIN_LOCKOUT_BUCKET);
    }
    return false;
  }

  async function fail(): Promise<void> {
    const at = now();
    const current = await findLoginFailure(db, LOGIN_LOCKOUT_BUCKET);
    const failures = (current?.failures ?? 0) + 1;
    const lockedUntil =
      failures >= LOGIN_LOCKOUT.maxFailures ? at + LOGIN_LOCKOUT.lockMs : null;
    await upsertLoginFailure(db, {
      source: LOGIN_LOCKOUT_BUCKET,
      failures,
      lockedUntil,
      updatedAt: at,
    });
  }

  async function succeed(): Promise<void> {
    await clearLoginFailures(db, LOGIN_LOCKOUT_BUCKET);
  }

  return { isLocked, fail, succeed };
}
