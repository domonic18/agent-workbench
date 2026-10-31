import type { CapabilityService } from "../../domain/capability/service.js";

const ISSUING_INTERVAL_MS = 60_000;
const PENDING_INTERVAL_MS = 10 * 60_000;

export interface JobLogger {
  info(obj: unknown, message?: string): void;
  warn(obj: unknown, message?: string): void;
  error(obj: unknown, message?: string): void;
}

export interface CapabilityReconciler {
  stop(): void;
}

/**
 * 单进程内串行对账(01 §9):issuing 每 60s 收敛,待批超时每 10 分钟检查。
 * 定时器 unref,不阻止进程退出;通知出口留到 M2-4 的飞书卡片。
 */
export function startCapabilityReconciler(
  service: CapabilityService,
  logger: JobLogger,
): CapabilityReconciler {
  const run = (label: string, task: () => number): void => {
    try {
      const changed = task();
      if (changed > 0) {
        logger.info({ changed }, `${label}对账收敛`);
      }
    } catch (error) {
      logger.error({ err: error }, `${label}对账失败`);
    }
  };

  const issuingTimer = setInterval(() => {
    run("issuing", () => service.reconcileStaleIssuing());
  }, ISSUING_INTERVAL_MS);
  issuingTimer.unref();

  const pendingTimer = setInterval(() => {
    run("pending", () => service.expireStalePending());
  }, PENDING_INTERVAL_MS);
  pendingTimer.unref();

  return {
    stop() {
      clearInterval(issuingTimer);
      clearInterval(pendingTimer);
    },
  };
}
