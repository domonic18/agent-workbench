import type { CardSender } from "../../adapters/feishu/card.js";
import type { OutboxPushPayload } from "../../reliability/outbox.js";
import { OUTBOX_TIMEOUTS } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  claimDue,
  markDelivered,
  markFailed,
  markRetry,
  reconcileStaleLeases,
  type OutboxRecord,
} from "../../store/repositories/outbox.js";
import type { JobLogger } from "./reconcile.js";

export interface OutboxSender {
  stop(): void;
}

export interface OutboxSenderOptions {
  now?: () => number;
  pollMs?: number;
}

/** 通知类指数退避:第 n 次失败等 base*2^n,封顶 retryMaxMs */
export function retryDelayMs(attempts: number): number {
  return Math.min(2 ** attempts * OUTBOX_TIMEOUTS.retryBaseMs, OUTBOX_TIMEOUTS.retryMaxMs);
}

async function deliverOne(
  db: Db,
  sender: CardSender,
  logger: JobLogger,
  row: OutboxRecord,
  at: number,
): Promise<void> {
  // payload_json 由 enqueuePush 写入且受 CHECK(json_valid) 约束,按既定形状直接解析
  const payload = JSON.parse(row.payloadJson) as OutboxPushPayload;

  try {
    await sender.send(payload);
    markDelivered(db, row.id, row.leaseToken);
    logger.info({ outboxId: row.id, attempts: row.attempts }, "发件箱投递成功");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (row.attempts >= OUTBOX_TIMEOUTS.maxAttempts) {
      markFailed(db, row.id, row.leaseToken, message);
      logger.error({ outboxId: row.id, attempts: row.attempts, err: error }, "发件箱投递失败,已达重试上限");
    } else {
      const nextAt = at + retryDelayMs(row.attempts);
      markRetry(db, row.id, row.leaseToken, nextAt, message);
      logger.warn({ outboxId: row.id, attempts: row.attempts, nextAt }, "发件箱投递失败,稍后重试");
    }
  }
}

/**
 * 跑一轮完整投递(01 §6 / §9):先回收过期租约,再逐条领取到期记录并同步发送。
 * 全部错误按可重试处理,超过 attempts 上限才判 failed(通知类只重试、不围栏任务)。
 */
export async function drainOutbox(
  db: Db,
  sender: CardSender,
  logger: JobLogger,
  now: () => number = Date.now,
): Promise<void> {
  try {
    const reconciled = reconcileStaleLeases(db, now());
    if (reconciled > 0) {
      logger.info({ reconciled }, "发件箱过期租约回收");
    }
  } catch (error) {
    logger.error({ err: error }, "发件箱租约回收失败");
  }

  for (;;) {
    const at = now();
    const row = claimDue(db, at, at + OUTBOX_TIMEOUTS.leaseMs);
    if (row === undefined) {
      return;
    }
    await deliverOne(db, sender, logger, row, at);
  }
}

export function startOutboxSender(
  db: Db,
  sender: CardSender,
  logger: JobLogger,
  options: OutboxSenderOptions = {},
): OutboxSender {
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? OUTBOX_TIMEOUTS.pollMs;
  let stopped = false;
  let running = false;

  const tick = (): void => {
    if (running || stopped) {
      return;
    }
    running = true;
    void drainOutbox(db, sender, logger, now)
      .catch((error: unknown) => logger.error({ err: error }, "发件箱作业异常"))
      .finally(() => {
        running = false;
      });
  };

  // 启动即有积压可投:先跑一轮,再定时轮询
  tick();
  const timer = setInterval(tick, pollMs);
  timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
