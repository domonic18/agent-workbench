import { TELEMETRY } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  deleteTimelineEventsIngestedBefore,
  rollupTokenUsageBefore,
} from "../../store/repositories/token-usage.js";
import type { JobLogger } from "./reconcile.js";

export interface TelemetryRetentionSweeper {
  stop(): void;
}

export interface TelemetryRetentionOptions {
  now?: () => number;
  timelineRetentionMs?: number;
  tokenUsageRawRetentionMs?: number;
  intervalMs?: number;
}

/**
 * 遥测滚动保留(02 §3.6):启动即扫一轮,此后每小时一次;失败只记日志,下一轮重试。
 * - timeline_event:按「入库时刻」删除,窗口外的展示数据不无限累积;
 * - token_usage:明细聚合进 token_usage_daily 后删除,长期口径从聚合读。
 */
export function startTelemetryRetention(
  db: Db,
  logger: JobLogger,
  options: TelemetryRetentionOptions = {},
): TelemetryRetentionSweeper {
  const now = options.now ?? Date.now;
  const timelineRetentionMs = options.timelineRetentionMs ?? TELEMETRY.timelineRetentionMs;
  const tokenUsageRawRetentionMs =
    options.tokenUsageRawRetentionMs ?? TELEMETRY.tokenUsageRawRetentionMs;

  const sweepUsage = (): void => {
    const at = now();
    // 聚合按 UTC 整天对齐:冷热视图的水位是「聚合表最大日 + 1 天」,切在半天里会漏算
    const cutoff = Math.floor((at - tokenUsageRawRetentionMs) / 86_400_000) * 86_400_000;
    void rollupTokenUsageBefore(db, cutoff, at)
      .then(({ aggregated }) => {
        if (aggregated > 0) {
          logger.info({ aggregated }, "token 用量明细聚合进日表");
        }
      })
      .catch((error) => {
        logger.error({ err: error }, "token 用量聚合失败");
      });
  };

  const sweepTimeline = (): void => {
    const cutoff = now() - timelineRetentionMs;
    void deleteTimelineEventsIngestedBefore(db, cutoff)
      .then((deleted) => {
        if (deleted > 0) {
          logger.info({ deleted }, "清理保留窗口外的会话时间线事件");
        }
      })
      .catch((error) => {
        logger.error({ err: error }, "会话时间线事件清理失败");
      });
  };

  const sweep = (): void => {
    sweepUsage();
    sweepTimeline();
  };

  sweep();
  const timer = setInterval(sweep, options.intervalMs ?? TELEMETRY.sweepIntervalMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
