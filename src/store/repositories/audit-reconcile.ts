import type { AuditGapKind } from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface NewAuditGap {
  /** 幂等去重键;同一缺口重跑只记一次 */
  dedupKey: string;
  kind: AuditGapKind;
  toolCallLogId: number | null;
  capabilityId: string | null;
  taskId: string | null;
  ticketId: string | null;
  sid: string | null;
  detail: unknown;
  detectedAt: number;
}

export interface AuditGapRecord {
  id: number;
  dedupKey: string;
  kind: AuditGapKind;
  toolCallLogId: number | null;
  capabilityId: string | null;
  taskId: string | null;
  ticketId: string | null;
  sid: string | null;
  detailJson: string;
  detectedAt: number;
}

export interface ToolCallWithCapability {
  toolCallLogId: number;
  taskId: string;
  ticketId: string | null;
  capabilityId: string;
}

export interface CapabilityTicket {
  capabilityId: string;
  ticketId: string;
  taskId: string;
}

/** append-only:INSERT OR IGNORE 按 dedup_key 去重,返回是否真新增 */
export function insertGap(db: Db, gap: NewAuditGap): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO audit_reconcile_gap
         (dedup_key, kind, tool_call_log_id, capability_id, task_id, ticket_id, sid, detail_json, detected_at)
       VALUES
         (@dedupKey, @kind, @toolCallLogId, @capabilityId, @taskId, @ticketId, @sid, @detailJson, @detectedAt)`,
    )
    .run({
      dedupKey: gap.dedupKey,
      kind: gap.kind,
      toolCallLogId: gap.toolCallLogId,
      capabilityId: gap.capabilityId,
      taskId: gap.taskId,
      ticketId: gap.ticketId,
      sid: gap.sid,
      detailJson: JSON.stringify(gap.detail ?? {}),
      detectedAt: gap.detectedAt,
    });
  return result.changes === 1;
}

/** 取窗口内所有需要核对的授权工具调用;capability_id 有索引,子集有界 */
export function findToolCallsWithCapability(
  db: Db,
  query: { since: number },
): ToolCallWithCapability[] {
  return db
    .prepare(
      `SELECT t.id AS toolCallLogId, t.task_id AS taskId, c.ticket_id AS ticketId,
              t.capability_id AS capabilityId
       FROM tool_call_log t
       JOIN capability c ON c.id = t.capability_id
       WHERE t.capability_id IS NOT NULL AND t.occurred_at >= @since
       ORDER BY t.id ASC`,
    )
    .all(query) as ToolCallWithCapability[];
}

/** 库中所有已签发票据,用于判定 Teleport 侧是否为「多出来的会话」 */
export function listCapabilityTickets(db: Db): CapabilityTicket[] {
  return db
    .prepare(
      `SELECT id AS capabilityId, ticket_id AS ticketId, task_id AS taskId
       FROM capability WHERE ticket_id IS NOT NULL`,
    )
    .all() as CapabilityTicket[];
}

const COLUMNS = `
  id, dedup_key AS dedupKey, kind, tool_call_log_id AS toolCallLogId,
  capability_id AS capabilityId, task_id AS taskId, ticket_id AS ticketId, sid,
  detail_json AS detailJson, detected_at AS detectedAt
`;

export interface GapListQuery {
  kind?: AuditGapKind;
  limit: number;
  /** keyset 游标:上一页最后一行的 (detectedAt, id) */
  before?: { detectedAt: number; id: number };
}

/** 按键集分页:`detected_at DESC, id DESC`,不用 offset */
export function listGaps(db: Db, query: GapListQuery): AuditGapRecord[] {
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit: query.limit };
  if (query.kind !== undefined) {
    conditions.push("kind = @kind");
    params.kind = query.kind;
  }
  if (query.before !== undefined) {
    conditions.push(
      "(detected_at < @beforeDetectedAt OR (detected_at = @beforeDetectedAt AND id < @beforeId))",
    );
    params.beforeDetectedAt = query.before.detectedAt;
    params.beforeId = query.before.id;
  }
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM audit_reconcile_gap ${where} ORDER BY detected_at DESC, id DESC LIMIT @limit`,
    )
    .all(params) as AuditGapRecord[];
}
