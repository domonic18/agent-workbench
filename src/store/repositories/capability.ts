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
  id, subject, target, action, scope_json AS "scopeJson", ttl_seconds AS "ttlSeconds",
  status, ticket_id AS "ticketId", task_id AS "taskId", issued_at AS "issuedAt",
  expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt", updated_at AS "updatedAt"
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

export async function insertCapability(db: Db, row: NewCapability): Promise<void> {
  await db.run(
    `INSERT INTO capability
       (id, subject, target, action, scope_json, ttl_seconds, status, task_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    row.id, row.subject, row.target, row.action, row.scopeJson, row.ttlSeconds,
    row.taskId, row.createdAt, row.createdAt,
  );
}

export async function findCapability(db: Db, id: string): Promise<CapabilityRecord | undefined> {
  return (await db.get(`SELECT ${COLUMNS} FROM capability WHERE id = ?`, id)) as
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
export async function listCapabilities(db: Db, query: CapabilityListQuery): Promise<CapabilityRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.statuses !== undefined && query.statuses.length > 0) {
    const base = params.length;
    const placeholders = query.statuses.map((_, index) => `$${base + index + 1}`);
    params.push(...query.statuses);
    conditions.push(`status IN (${placeholders.join(", ")})`);
  } else if (query.status !== undefined) {
    conditions.push("status = ?");
    params.push(query.status);
  }
  if (query.before !== undefined) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(query.before.createdAt, query.before.createdAt, query.before.id);
  }
  params.push(query.limit);
  const limitIdx = `$${params.length}`;
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  return (await db.all(
    `SELECT ${COLUMNS} FROM capability ${where} ORDER BY created_at DESC, id DESC LIMIT ${limitIdx}`,
    ...params,
  )) as CapabilityRecord[];
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
export async function listCapabilitySummariesByTask(db: Db, taskId: string): Promise<CapabilitySummary[]> {
  return (await db.all(
    `SELECT id, target, action, scope_json AS "scopeJson", status,
            expires_at AS "expiresAt", created_at AS "createdAt"
       FROM capability WHERE task_id = ? ORDER BY created_at DESC, id DESC`,
    taskId,
  )) as CapabilitySummary[];
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
export async function transitionCapability(db: Db, input: CapabilityTransition): Promise<boolean> {
  const sets = ["status = ?", "updated_at = ?"];
  const params: unknown[] = [input.to, input.now];
  if (input.ticketId !== undefined) {
    sets.push("ticket_id = ?");
    params.push(input.ticketId);
  }
  if (input.issuedAt !== undefined) {
    sets.push("issued_at = ?");
    params.push(input.issuedAt);
  }
  if (input.expiresAt !== undefined) {
    sets.push("expires_at = ?");
    params.push(input.expiresAt);
  }
  if (input.revokedAt !== undefined) {
    sets.push("revoked_at = ?");
    params.push(input.revokedAt);
  }
  const result = await db.run(
    `UPDATE capability SET ${sets.join(", ")} WHERE id = ? AND status = ?`,
    ...params, input.id, input.from,
  );
  return result.changes === 1;
}

export interface NewAuditEntry {
  capabilityId: string;
  action: CapabilityAuditAction;
  actor: string;
  detail?: unknown;
  occurredAt: number;
}

export async function appendCapabilityAudit(db: Db, entry: NewAuditEntry): Promise<void> {
  await db.run(
    `INSERT INTO capability_audit (capability_id, action, actor, detail_json, occurred_at)
     VALUES (?, ?, ?, ?, ?)`,
    entry.capabilityId, entry.action, entry.actor,
    JSON.stringify(entry.detail ?? {}), entry.occurredAt,
  );
}

export async function findStalePending(db: Db, cutoff: number, limit = 100): Promise<CapabilityRecord[]> {
  return (await db.all(
    `SELECT ${COLUMNS} FROM capability
     WHERE status = 'pending' AND created_at < ?
     ORDER BY created_at ASC LIMIT ?`,
    cutoff, limit,
  )) as CapabilityRecord[];
}

export async function findStaleIssuing(db: Db, cutoff: number, limit = 100): Promise<CapabilityRecord[]> {
  return (await db.all(
    `SELECT ${COLUMNS} FROM capability
     WHERE status = 'issuing' AND updated_at < ?
     ORDER BY updated_at ASC LIMIT ?`,
    cutoff, limit,
  )) as CapabilityRecord[];
}
