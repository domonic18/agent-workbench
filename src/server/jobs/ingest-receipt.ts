import { INGEST } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { deleteIngestReceiptsBefore } from "../../store/repositories/ingest-receipt.js";
import type { JobLogger } from "./reconcile.js";

export interface IngestReceiptCleaner {
  stop(): void;
}

export interface IngestReceiptCleanerOptions {
  now?: () => number;
  retentionMs?: number;
  intervalMs?: number;
}

/** 去重窗口滚动清理(02 §3.8):启动即扫一轮,此后每小时一次;失败只记日志 */
export function startIngestReceiptCleaner(
  db: Db,
  logger: JobLogger,
  options: IngestReceiptCleanerOptions = {},
): IngestReceiptCleaner {
  const now = options.now ?? Date.now;
  const retentionMs = options.retentionMs ?? INGEST.receiptRetentionMs;

  const sweep = (): void => {
    try {
      const deleted = deleteIngestReceiptsBefore(db, now() - retentionMs);
      if (deleted > 0) {
        logger.info({ deleted }, "清理过期的采集去重回执");
      }
    } catch (error) {
      logger.error({ err: error }, "清理采集去重回执失败");
    }
  };

  sweep();
  const timer = setInterval(sweep, options.intervalMs ?? INGEST.receiptSweepIntervalMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
