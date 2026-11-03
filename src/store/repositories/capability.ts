import type {
  CapabilityAction,
  CapabilityAuditAction,
  CapabilityStatus,
} from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface CapabilityRecord {
  id: string;
  subject: string;
  target: string;
  action: CapabilityAction;
  scopeJson: string;
  ttlSeconds: number;
  status: CapabilityStatus;
  ticketId: string | null;
  taskId: string;
  issuedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const COLUMNS = `
  id, subject, target, action, scope_json AS scopeJson, ttl_seconds AS ttlSeconds,
  status, ticket_id AS ticketId, task_id AS taskId, issued_at AS issuedAt,
  expires_at AS expiresAt, revoked_at AS revokedAt, created_at AS createdAt, updated_at AS updatedAt
`;

export interface NewCapability {
  id: string;
  subject: string;
  target: string;
  action: CapabilityAction;
  scopeJson: string;
  ttlSeconds: number;
  taskId: string;
  createdAt: number;
}

export function insertCapability(db: Db, row: NewCapability): Promise<void>{
  await db.run(
    `INSERT INTO capability
       (id, subject, target, action, scope_json, ttl_seconds, status, task_id, created_at, updated_at)
     VALUES (@id, @subject, @target, @action, @scopeJson, @ttlSeconds, 'pending', @taskId, @createdAt, @createdAt)`,
  , row);
}

export function findCapability(db: Db, id: string): Promise<CapabilityRecord | undefined>{
  return await db.get(`SELECT ${COLUMNS} FROM capability WHERE id = ?`, id) as
    | CapabilityRecord
    | undefined;
}

export interface CapabilityListQuery {
  status?: CapabilityStatus;
  /** 三视图:一次取一组状态(待批 = pending+issuing,历史 = expired+revoked+rejected) */
  statuses?: readonly CapabilityStatus[];
  limit: number;
  /** keyset 游标:上一页最后一行的 (createdAt, id) */
  before?: { createdAt: number; id: string };
}

/** 按键集分页:`created_at DESC, id DESC`,不用 offset */
export function listCapabilities(db: Db, query: CapabilityListQuery): Promise<CapabilityRecord[]>{
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit: query.limit };
  if (query.statuses !== undefined && query.statuses.length > 0) {
    const placeholders = query.statuses.map((status, index) => {
      params[`status${index}`] = status;
      return `@status${index}`;
    });
    conditions.push(`status IN (${placeholders.join(", ")})`);
  } else if (query.status !== undefined) {
    conditions.push("status = @status");
    params.status = query.status;
  }
  if (query.before !== undefined) {
    conditions.push("(created_at < @beforeCreatedAt OR (created_at = @beforeCreatedAt AND id < @beforeId))");
    params.beforeCreatedAt = query.before.createdAt;
    params.beforeId = query.before.id;
  }
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  return await db.all(
      `SELECT ${COLUMNS} FROM capability ${where} ORDER BY created_at DESC, id DESC LIMIT @limit`,
    , params) as CapabilityRecord[];
}

export interface CapabilitySummary {
  id: string;
  target: string;
  action: CapabilityAction;
  scopeJson: string;
  status: CapabilityStatus;
  expiresAt: number | null;
  createdAt: number;
}

/** 任务详情附带的授权摘要:不含 ticket 标识与证书内容 */
export function listCapabilitySummariesByTask(db: Db, taskId: string): Promise<CapabilitySummary[]>{
  return await db.all(
      `SELECT id, target, action, scope_json AS scopeJson, status,
              expires_at AS expiresAt, created_at AS createdAt
         FROM capability WHERE task_id = ? ORDER BY created_at DESC, id DESC`,
    , taskId) as CapabilitySummary[];
}

export interface CapabilityTransition {
  id: string;
  from: CapabilityStatus;
  to: CapabilityStatus;
  now: number;
  ticketId?: string;
  issuedAt?: number;
  expiresAt?: number;
  revokedAt?: number;
}

/** 条件更新(CAS):只有当前状态仍是 `from` 才迁移,返回是否真正发生跃迁 */
export function transitionCapability(db: Db, input: CapabilityTransition): Promise<boolean>{
  const sets = ["status = @to", "updated_at = @now"];
  const params: Record<string, unknown> = {
    id: input.id,
    from: input.from,
    to: input.to,
    now: input.now,
  };
  if (input.ticketId !== undefined) {
    sets.push("ticket_id = @ticketId");
    params.ticketId = input.ticketId;
  }
  if (input.issuedAt !== undefined) {
    sets.push("issued_at = @issuedAt");
    params.issuedAt = input.issuedAt;
  }
  if (input.expiresAt !== undefined) {
    sets.push("expires_at = @expiresAt");
    params.expiresAt = input.expiresAt;
  }
  if (input.revokedAt !== undefined) {
    sets.push("revoked_at = @revokedAt");
    params.revokedAt = input.revokedAt;
  }
  const result = await db.run(`UPDATE capability SET ${sets.join(", ")} WHERE id = ? AND status = ?`, params.id, params.from);
  return result.changes === 1;
}

export interface NewAuditEntry {
  capabilityId: string;
  action: CapabilityAuditAction;
  actor: string;
  detail?: unknown;
  occurredAt: number;
}

export function appendCapabilityAudit(db: Db, entry: NewAuditEntry): Promise<void>{
  await db.run(
    `INSERT INTO capability_audit (capability_id, action, actor, detail_json, occurred_at)
     VALUES (?, ?, ?, ?, ?)`,
  , entry.capabilityId,
    entry.action,
    entry.actor,
    JSON.stringify(entry.detail ?? {}),
    entry.occurredAt,);
}

export function findStalePending(db: Db, cutoff: number, limit = 100): Promise<CapabilityRecord[]>{
  return await db.all(
      `SELECT ${COLUMNS} FROM capability
       WHERE status = 'pending' AND created_at < ?
       ORDER BY created_at ASC LIMIT ?`,
    , cutoff, limit) as CapabilityRecord[];
}

export function findStaleIssuing(db: Db, cutoff: number, limit = 100): Promise<CapabilityRecord[]>{
  return await db.all(
      `SELECT ${COLUMNS} FROM capability
       WHERE status = 'issuing' AND updated_at < ?
       ORDER BY updated_at ASC LIMIT ?`,
    , cutoff, limit) as CapabilityRecord[];
}
