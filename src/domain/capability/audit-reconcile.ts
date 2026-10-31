import type {
  SessionStartEvent,
  TeleportAuditAdapter,
} from "../../adapters/teleport/audit.js";
import type { Db } from "../../store/database.js";
import {
  findToolCallsWithCapability,
  insertGap,
  listCapabilityTickets,
  type NewAuditGap,
} from "../../store/repositories/audit-reconcile.js";

/** 回溯窗口:只核对近期授权调用,更早的由缺口表留档 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ReconcileResult {
  /** 本轮核对的授权工具调用数 */
  scanned: number;
  /** 读到的 Teleport session.start 事件数 */
  sessions: number;
  /** 本轮新增的缺口数(幂等重跑为 0) */
  inserted: number;
}

export interface AuditReconciler {
  reconcile(): Promise<ReconcileResult>;
}

export interface AuditReconcilerDeps {
  db: Db;
  teleportAudit: TeleportAuditAdapter;
  now?: () => number;
}

/**
 * 审计对账(05 §7):逐条核对 tool_call_log → capability(ticket_id) → session.start。
 * 只读事实,不做修复;对不上的落缺口表,重跑按 dedup_key 幂等。
 */
export function createAuditReconciler(deps: AuditReconcilerDeps): AuditReconciler {
  const { db, teleportAudit } = deps;
  const now = deps.now ?? Date.now;

  return {
    async reconcile() {
      const at = now();
      const events = await teleportAudit.listSessionStarts();

      // ticket → 该 ticket 下的会话(可能一次任务多次连接)
      const sessionsByTicket = new Map<string, SessionStartEvent[]>();
      for (const event of events) {
        if (event.ticketId === null) {
          continue;
        }
        const bucket = sessionsByTicket.get(event.ticketId);
        if (bucket === undefined) {
          sessionsByTicket.set(event.ticketId, [event]);
        } else {
          bucket.push(event);
        }
      }

      let inserted = 0;
      const add = (gap: Omit<NewAuditGap, "detectedAt">): void => {
        if (insertGap(db, { ...gap, detectedAt: at })) {
          inserted += 1;
        }
      };

      const rows = findToolCallsWithCapability(db, { since: at - WINDOW_MS });
      for (const row of rows) {
        if (row.ticketId === null) {
          add({
            dedupKey: `missing_session:no_ticket:${row.toolCallLogId}`,
            kind: "missing_session",
            toolCallLogId: row.toolCallLogId,
            capabilityId: row.capabilityId,
            taskId: row.taskId,
            ticketId: null,
            sid: null,
            detail: { reason: "capability.ticket_id 为空,无法追到 Teleport 会话" },
          });
          continue;
        }
        const sessions = sessionsByTicket.get(row.ticketId) ?? [];
        if (sessions.length === 0) {
          add({
            dedupKey: `missing_session:${row.toolCallLogId}`,
            kind: "missing_session",
            toolCallLogId: row.toolCallLogId,
            capabilityId: row.capabilityId,
            taskId: row.taskId,
            ticketId: row.ticketId,
            sid: null,
            detail: { reason: "Teleport 无对应 session.start" },
          });
          continue;
        }
        if (!sessions.some((event) => event.taskId === row.taskId)) {
          add({
            dedupKey: `ticket_mismatch:${row.toolCallLogId}`,
            kind: "ticket_mismatch",
            toolCallLogId: row.toolCallLogId,
            capabilityId: row.capabilityId,
            taskId: row.taskId,
            ticketId: row.ticketId,
            sid: sessions[0]?.sid ?? null,
            detail: {
              expectedTaskId: row.taskId,
              observedTaskIds: [...new Set(sessions.map((event) => event.taskId))],
            },
          });
        }
      }

      // 反向:Teleport 侧有会话、库里查不到对应票据 → 多出来的连接
      const knownTickets = new Set(listCapabilityTickets(db).map((row) => row.ticketId));
      for (const event of events) {
        if (event.ticketId === null || knownTickets.has(event.ticketId)) {
          continue;
        }
        add({
          dedupKey: `orphan_session:${event.sid}`,
          kind: "orphan_session",
          toolCallLogId: null,
          capabilityId: null,
          taskId: event.taskId,
          ticketId: event.ticketId,
          sid: event.sid,
          detail: { user: event.user, login: event.login, time: event.time },
        });
      }

      return { scanned: rows.length, sessions: events.length, inserted };
    },
  };
}
