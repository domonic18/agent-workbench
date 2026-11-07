import { sweepDeadLetters } from "../../domain/a2a/dead-letter.js";
import { A2A_DEAD_LETTER } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import type { JobLogger } from "./reconcile.js";

export interface DeadLetterSweeper {
  stop(): void;
  /** 首次巡检完成(无论成败)后 resolve,便于测试精确等待 */
  initial: Promise<void>;
}

export interface DeadLetterSweeperOptions {
  now?: () => number;
  intervalMs?: number;
  /** 回执落库后唤醒发起方的长轮询,须与路由共用同一 A2A 服务实例 */
  wake?: (agentId: string) => void;
}

/** 死信巡检(01 §9):启动即扫一轮,此后每 60s 一次;失败只记日志,不影响主服务 */
export function startDeadLetterSweeper(
  db: Db,
  logger: JobLogger,
  options: DeadLetterSweeperOptions = {},
): DeadLetterSweeper {
  let resolveInitial: (() => void) | undefined;
  const initial = new Promise<void>((resolve) => {
    resolveInitial = resolve;
  });

  const sweep = (): void => {
    void sweepDeadLetters({
      db,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.wake === undefined ? {} : { wake: options.wake }),
    })
      .then((result) => {
        if (result.deadLettered > 0) {
          logger.info(result, "A2A 死信巡检转入死信");
        }
      })
      .catch((error) => {
        logger.error({ err: error }, "A2A 死信巡检失败");
      })
      .finally(() => {
        resolveInitial?.();
      });
  };

  sweep();
  const timer = setInterval(sweep, options.intervalMs ?? A2A_DEAD_LETTER.sweepIntervalMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
    initial,
  };
}
