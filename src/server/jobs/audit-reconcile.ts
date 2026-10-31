import type { AuditReconciler } from "../../domain/capability/audit-reconcile.js";

const AUDIT_RECONCILE_INTERVAL_MS = 5 * 60_000;

export interface AuditReconcileLogger {
  info(obj: unknown, message?: string): void;
  warn(obj: unknown, message?: string): void;
  error(obj: unknown, message?: string): void;
}

export interface AuditReconcileJob {
  stop(): void;
}

/**
 * 审计对账作业(05 §7):启动即跑一轮,之后每 5 分钟一次。
 * 定时器 unref,不阻止进程退出;上一轮未结束则跳过本轮,避免读日志与写库堆积。
 */
export function startAuditReconciler(
  reconciler: AuditReconciler,
  logger: AuditReconcileLogger,
): AuditReconcileJob {
  let running = false;

  const tick = (): void => {
    if (running) {
      return;
    }
    running = true;
    void reconciler
      .reconcile()
      .then((result) => {
        // 只有确实有待核对调用时,「零会话」才说明对账失明;空库空日志不刷告警
        if (result.scanned > 0 && result.sessions === 0) {
          logger.warn(
            { scanned: result.scanned },
            "Teleport 审计无 session.start 事件,本轮对账可能不完整",
          );
        }
        if (result.inserted > 0) {
          logger.info(result, "审计对账发现新缺口");
        }
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "审计对账失败");
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, AUDIT_RECONCILE_INTERVAL_MS);
  timer.unref();
  tick();

  return { stop: () => clearInterval(timer) };
}
