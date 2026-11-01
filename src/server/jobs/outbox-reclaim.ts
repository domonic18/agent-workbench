import { OUTBOX_TIMEOUTS } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { reconcileStaleLeases, type ReconcileOutcome } from "../../store/repositories/outbox.js";
import type { JobLogger } from "./reconcile.js";

export interface OutboxReclaimer {
  stop(): void;
}

export interface OutboxReclaimerOptions {
  now?: () => number;
  intervalMs?: number;
}

/**
 * pull 通道以 ACK 为判据:未 ACK 的 claimed 行过期必须回到 retry_wait 才对端可见。
 * 与 push 投递解耦,避免「未配置飞书 → 无 push worker → 租约无人回收」。
 */
export function reclaimOnce(db: Db, now: number, logger: JobLogger): ReconcileOutcome {
  const outcome = reconcileStaleLeases(db, now);
  if (outcome.retryWait > 0 || outcome.uncertain > 0) {
    logger.info(outcome, "发件箱过期租约回收");
  }
  return outcome;
}

export function startOutboxReclaimer(
  db: Db,
  logger: JobLogger,
  options: OutboxReclaimerOptions = {},
): OutboxReclaimer {
  const now = options.now ?? Date.now;

  const sweep = (): void => {
    try {
      reclaimOnce(db, now(), logger);
    } catch (error) {
      logger.error({ err: error }, "发件箱租约回收失败");
    }
  };

  sweep();
  const timer = setInterval(sweep, options.intervalMs ?? OUTBOX_TIMEOUTS.pollMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
