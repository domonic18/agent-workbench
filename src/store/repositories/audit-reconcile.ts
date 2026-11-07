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

/** append-only:INSERT ON CONFLICT DO NOTHING 按 dedup_key 去重,返回是否真新增 */
export async function insertGap(db: Db, gap: NewAuditGap): Promise<boolean> {
  const result = await db.run(
    `INSERT INTO audit_reconcile_gap
       (dedup_key, kind, tool_call_log_id, capability_id, task_id, ticket_id, sid, detail_json, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (dedup_key) DO NOTHING`,
    gap.dedupKey, gap.kind, gap.toolCallLogId, gap.capabilityId, gap.taskId,
    gap.ticketId, gap.sid, JSON.stringify(gap.detail ?? {}), gap.detectedAt,
  );
  return result.changes === 1;
}

/** 取窗口内所有需要核对的授权工具调用;capability_id 有索引,子集有界 */
export async function findToolCallsWithCapability(
  db: Db,
  query: { since: number },
): Promise<ToolCallWithCapability[]> {
  return (await db.all(
    `SELECT t.id AS "toolCallLogId", t.task_id AS "taskId", c.ticket_id AS "ticketId",
            t.capability_id AS "capabilityId"
     FROM tool_call_log t
     JOIN capability c ON c.id = t.capability_id
     WHERE t.capability_id IS NOT NULL AND t.occurred_at >= ?
     ORDER BY t.id ASC`,
    query.since,
  )) as ToolCallWithCapability[];
}

/** 库中所有已签发票据,用于判定 Teleport 侧是否为「多出来的会话」 */
export async function listCapabilityTickets(db: Db): Promise<CapabilityTicket[]> {
  return (await db.all(
    `SELECT id AS "capabilityId", ticket_id AS "ticketId", task_id AS "taskId"
     FROM capability WHERE ticket_id IS NOT NULL`,
  )) as CapabilityTicket[];
}

const COLUMNS = `
  id, dedup_key AS "dedupKey", kind, tool_call_log_id AS "toolCallLogId",
  capability_id AS "capabilityId", task_id AS "taskId", ticket_id AS "ticketId", sid,
  detail_json AS "detailJson", detected_at AS "detectedAt"
`;

export interface GapListQuery {
  kind?: AuditGapKind;
  limit: number;
  /** keyset 游标:上一页最后一行的 (detectedAt, id) */
  before?: { detectedAt: number; id: number };
}

/** 按键集分页:`detected_at DESC, id DESC`,不用 offset */
export async function listGaps(db: Db, query: GapListQuery): Promise<AuditGapRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.kind !== undefined) {
    conditions.push("kind = ?");
    params.push(query.kind);
  }
  if (query.before !== undefined) {
    conditions.push("(detected_at < ? OR (detected_at = ? AND id < ?))");
    params.push(query.before.detectedAt, query.before.detectedAt, query.before.id);
  }
  params.push(query.limit);
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  return (await db.all(
    `SELECT ${COLUMNS} FROM audit_reconcile_gap ${where} ORDER BY detected_at DESC, id DESC LIMIT ?`,
    ...params,
  )) as AuditGapRecord[];
}
