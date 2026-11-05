import { WORK_INBOX } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { reclaimExpiredInbox } from "../../store/repositories/work-inbox.js";
import type { JobLogger } from "./reconcile.js";

export interface WorkInboxReclaimer {
  stop(): void;
}

export interface WorkInboxReclaimerOptions {
  now?: () => number;
  intervalMs?: number;
}

/**
 * worker_inbox 过期租约回收(01 §10):claimed → pending 并递增租约 token。
 * 只改状态不建任何新行——「重投不重复建 Task」由此成立,重复副作用由
 * Agent 侧按 (work_item_id, 已有 task) 自行幂等吸收。
 */
export async function reclaimWorkInboxOnce(db: Db, now: number, logger: JobLogger): Promise<number> {
  const reclaimed = await reclaimExpiredInbox(db, now);
  if (reclaimed > 0) {
    logger.info({ reclaimed }, "worker_inbox 过期租约回收");
  }
  return reclaimed;
}

export function startWorkInboxReclaimer(
  db: Db,
  logger: JobLogger,
  options: WorkInboxReclaimerOptions = {},
): WorkInboxReclaimer {
  const now = options.now ?? Date.now;

  const sweep = (): void => {
    void reclaimWorkInboxOnce(db, now(), logger).catch((error) => {
      logger.error({ err: error }, "worker_inbox 租约回收失败");
    });
  };

  sweep();
  const timer = setInterval(sweep, options.intervalMs ?? WORK_INBOX.pollMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
