import type { Db } from "../database.js";

export interface WorkThreadRecord {
  id: string;
  source: string;
  externalKind: string;
  externalKey: string;
  project: string;
  status: "active" | "closed";
  lastTriggerAt: number | null;
  createdAt: number;
}

const THREAD_COLUMNS = `
  id, source, external_kind AS "externalKind", external_key AS "externalKey",
  project, status, last_trigger_at AS "lastTriggerAt", created_at AS "createdAt"
`;

export interface NewWorkThread {
  id: string;
  source: string;
  externalKind: string;
  externalKey: string;
  project: string;
  createdAt: number;
}

/** Thread 建联幂等:同一 (source, external_kind, external_key) 只有一条稳定身份行 */
export async function insertWorkThreadIfNew(db: Db, row: NewWorkThread): Promise<boolean> {
  const inserted = await db.run(
    `INSERT INTO work_thread (id, source, external_kind, external_key, project, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (source, external_kind, external_key) DO NOTHING`,
    row.id,
    row.source,
    row.externalKind,
    row.externalKey,
    row.project,
    row.createdAt,
  );
  return inserted.changes === 1;
}

export async function findWorkThreadByKey(
  db: Db,
  source: string,
  externalKind: string,
  externalKey: string,
): Promise<WorkThreadRecord | undefined> {
  return (await db.get(
    `SELECT ${THREAD_COLUMNS} FROM work_thread
      WHERE source = ? AND external_kind = ? AND external_key = ?`,
    source,
    externalKind,
    externalKey,
  )) as WorkThreadRecord | undefined;
}

export function touchWorkThreadTrigger(db: Db, id: string, at: number): Promise<{ changes: number }> {
  return db.run("UPDATE work_thread SET last_trigger_at = ? WHERE id = ?", at, id);
}

export interface ThreadSubscriptionRecord {
  id: string;
  workThreadId: string;
  workItemId: string;
  taskId: string | null;
  mode: "owner" | "context";
  createdBy: string;
  policyVersion: string;
  createdAt: number;
  revokedAt: number | null;
}

const SUBSCRIPTION_COLUMNS = `
  id, work_thread_id AS "workThreadId", work_item_id AS "workItemId", task_id AS "taskId",
  mode, created_by AS "createdBy", policy_version AS "policyVersion",
  created_at AS "createdAt", revoked_at AS "revokedAt"
`;

export interface NewThreadSubscription {
  id: string;
  workThreadId: string;
  workItemId: string;
  mode: "owner" | "context";
  createdBy: string;
  policyVersion: string;
  createdAt: number;
}

/**
 * owner 订阅幂等建联:一个 Thread 至多一个有效 owner(部分唯一索引兜底,
 * 冲突目标以索引谓词显式推断)。已有有效 owner 时返回 false,
 * 换 owner 必须走「撤销旧 + 建新」的显式事务(arch/01 §9.3)。
 */
export async function insertSubscriptionIfNew(db: Db, row: NewThreadSubscription): Promise<boolean> {
  const inserted = await db.run(
    `INSERT INTO thread_subscription
       (id, work_thread_id, work_item_id, mode, created_by, policy_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (work_thread_id) WHERE mode = 'owner' AND revoked_at IS NULL DO NOTHING`,
    row.id,
    row.workThreadId,
    row.workItemId,
    row.mode,
    row.createdBy,
    row.policyVersion,
    row.createdAt,
  );
  return inserted.changes === 1;
}

export async function findActiveOwnerSubscription(
  db: Db,
  workThreadId: string,
): Promise<ThreadSubscriptionRecord | undefined> {
  return (await db.get(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM thread_subscription
      WHERE work_thread_id = ? AND mode = 'owner' AND revoked_at IS NULL`,
    workThreadId,
  )) as ThreadSubscriptionRecord | undefined;
}

export async function revokeSubscription(db: Db, id: string, at: number): Promise<boolean> {
  return (
    (
      await db.run(
        "UPDATE thread_subscription SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        at,
        id,
      )
    ).changes === 1
  );
}

export interface WorkItemThreadLink {
  subscriptionId: string;
  threadId: string;
  source: string;
  externalKind: string;
  externalKey: string;
  mode: "owner" | "context";
  createdAt: number;
  revokedAt: number | null;
}

/** 事项详情的关联线索:订阅及其 Thread 身份,含已撤销行供换绑历史 */
export async function listThreadLinksByWorkItem(
  db: Db,
  workItemId: string,
): Promise<WorkItemThreadLink[]> {
  return (await db.all(
    `SELECT s.id AS "subscriptionId", t.id AS "threadId", t.source,
            t.external_kind AS "externalKind", t.external_key AS "externalKey",
            s.mode, s.created_at AS "createdAt", s.revoked_at AS "revokedAt"
       FROM thread_subscription s JOIN work_thread t ON t.id = s.work_thread_id
      WHERE s.work_item_id = ? ORDER BY s.created_at ASC, s.id ASC`,
    workItemId,
  )) as WorkItemThreadLink[];
}
