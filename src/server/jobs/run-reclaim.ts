import { RUN_IDLE_GAP_MS, RUN_RECLAIM } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { sweepStaleRunningRuns } from "../../store/repositories/run.js";
import type { JobLogger } from "./reconcile.js";

export interface RunReclaimer {
  stop(): void;
}

export interface RunReclaimDeps {
  db: Db;
  now: () => number;
}

export interface RunReclaimResult {
  swept: string[];
}

/**
 * 迟滞 run 兜底收敛(04 §2 三层信号之 L3):
 * running 且 last_seen 超 idle 阈值 → 收尾在最后一次活动(orphan_swept)。
 * 惰性切分只在新事件到达同一流时生效,会话正常结束的最后一段 run 由此层收口——
 * 不变量:running 是临时状态,任何上游信号缺失时仍在有限时间(阈值 + 一个巡检周期)收敛。
 * 与惰性切分同一 30 分钟口径;比对用服务器时钟,跨机偏差相对 gap 可忽略。
 */
export async function reclaimRunsOnce(
  deps: RunReclaimDeps,
  logger: JobLogger,
): Promise<RunReclaimResult> {
  const staleBefore = deps.now() - RUN_IDLE_GAP_MS;
  const swept = await sweepStaleRunningRuns(deps.db, staleBefore);
  if (swept.length > 0) {
    logger.info({ count: swept.length, ids: swept }, "迟滞 run 兜底收尾");
  }
  return { swept };
}

export function startRunReclaimer(
  deps: RunReclaimDeps,
  logger: JobLogger,
  intervalMs: number = RUN_RECLAIM.pollMs,
): RunReclaimer {
  const sweep = (): void => {
    void reclaimRunsOnce(deps, logger).catch((error) => {
      logger.error({ err: error }, "迟滞 run 兜底收尾失败");
    });
  };

  sweep();
  const timer = setInterval(sweep, intervalMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
