import type { Db } from "../database.js";
import type { WorkerInboxKind, WorkerInboxStatus } from "../../shared/constants.js";

export interface WorkerInboxRecord {
  id: string;
  kind: WorkerInboxKind;
  workItemId: string;
  triggerId: string | null;
  targetAgentId: string;
  taskId: string | null;
  status: WorkerInboxStatus;
  idempotencyKey: string;
  leaseToken: number;
  leaseUntil: number | null;
  payloadJson: string;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

const FULL_COLUMNS = `
  id, kind, work_item_id AS "workItemId", trigger_id AS "triggerId",
  target_agent_id AS "targetAgentId", task_id AS "taskId", status,
  idempotency_key AS "idempotencyKey", lease_token AS "leaseToken",
  lease_until AS "leaseUntil", payload_json AS "payloadJson", reason,
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export interface NewWorkerInbox {
  id: string;
  kind: WorkerInboxKind;
  workItemId: string;
  triggerId: string | null;
  targetAgentId: string;
  idempotencyKey: string;
  payloadJson: string;
  createdAt: number;
}

/** 幂等入箱:同一 idempotency_key 只投递一次,重放不重复建行 */
export async function insertWorkerInboxIfNew(db: Db, row: NewWorkerInbox): Promise<boolean> {
  const inserted = await db.run(
    `INSERT INTO worker_inbox
       (id, kind, work_item_id, trigger_id, target_agent_id, idempotency_key,
        payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    row.id,
    row.kind,
    row.workItemId,
    row.triggerId,
    row.targetAgentId,
    row.idempotencyKey,
    row.payloadJson,
    row.createdAt,
    row.createdAt,
  );
  return inserted.changes === 1;
}

export async function findInboxById(db: Db, id: string): Promise<WorkerInboxRecord | undefined> {
  return (await db.get(`SELECT ${FULL_COLUMNS} FROM worker_inbox WHERE id = ?`, id)) as
    | WorkerInboxRecord
    | undefined;
}

/**
 * 领取本 Agent 的全部待处理行(照 outbox.claimDue 三段式,扩到多行):
 * pending → claimed,租约 token 单调递增;过期租约不能提交结果。
 * 单进程串行调用下 select + 条件更新无并发窗口。
 */
export async function claimPendingForAgent(
  db: Db,
  agentId: string,
  now: number,
  leaseUntil: number,
): Promise<WorkerInboxRecord[]> {
  const candidates = (await db.all(
    `SELECT id FROM worker_inbox
      WHERE target_agent_id = ? AND status = 'pending'
      ORDER BY created_at ASC, id ASC`,
    agentId,
  )) as { id: string }[];
  const claimed: WorkerInboxRecord[] = [];
  for (const candidate of candidates) {
    const updated = await db.run(
      `UPDATE worker_inbox
          SET status = 'claimed', lease_token = lease_token + 1, lease_until = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'`,
      leaseUntil,
      now,
      candidate.id,
    );
    if (updated.changes === 1) {
      const row = await findInboxById(db, candidate.id);
      if (row !== undefined) {
        claimed.push(row);
      }
    }
  }
  return claimed;
}

/** claimed → acked:Assignment ACK 携带承接 Task;Input 仅消费。CAS 失败=租约过期已重投 */
export async function ackInbox(
  db: Db,
  id: string,
  leaseToken: number,
  taskId: string | null,
  now: number,
): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE worker_inbox
            SET status = 'acked', task_id = ?, updated_at = ?
          WHERE id = ? AND lease_token = ? AND status = 'claimed'`,
        taskId,
        now,
        id,
        leaseToken,
      )
    ).changes === 1
  );
}

/** claimed → handed_back:单事件退回,不等于退订整个 Thread(arch/01 §9.3) */
export async function handbackInbox(
  db: Db,
  id: string,
  leaseToken: number,
  reason: string,
  now: number,
): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE worker_inbox
            SET status = 'handed_back', reason = ?, updated_at = ?
          WHERE id = ? AND lease_token = ? AND status = 'claimed'`,
        reason,
        now,
        id,
        leaseToken,
      )
    ).changes === 1
  );
}

/**
 * 租约回收(arch/01 §10):过期 claimed → pending 并递增租约 token,重投可被再次领取。
 * 只改状态不建新行——「不重复建 Task/WorkItem」由此成立;重复副作用由 Agent 侧
 * 按 (work_item_id, 已有 task) 自行幂等吸收。
 */
export async function reclaimExpiredInbox(db: Db, now: number): Promise<number> {
  const result = await db.run(
    `UPDATE worker_inbox
        SET status = 'pending', lease_token = lease_token + 1, lease_until = NULL, updated_at = ?
      WHERE status = 'claimed' AND lease_until IS NOT NULL AND lease_until <= ?`,
    now,
  );
  return result.changes;
}

/**
 * 事项的当前承接者 = 最新一条仍活跃(claimed/acked)的 assignment 目标。
 * owner 直通的 Input 发给这个人;无活跃承接者时由上层按确定性 needs_person 处置。
 */
export async function findActiveAssignee(
  db: Db,
  workItemId: string,
): Promise<string | undefined> {
  const row = (await db.get(
    `SELECT target_agent_id AS "targetAgentId" FROM worker_inbox
      WHERE work_item_id = ? AND kind = 'assignment' AND status IN ('claimed', 'acked')
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    workItemId,
  )) as { targetAgentId: string } | undefined;
  return row?.targetAgentId;
}

export async function listInboxForWorkItem(
  db: Db,
  workItemId: string,
): Promise<WorkerInboxRecord[]> {
  return (await db.all(
    `SELECT ${FULL_COLUMNS} FROM worker_inbox WHERE work_item_id = ? ORDER BY created_at ASC, id ASC`,
    workItemId,
  )) as WorkerInboxRecord[];
}
