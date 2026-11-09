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
          SET status = 'claimed', lease_token = lease_token + 1, lease_until = ?, reason = NULL, updated_at = ?
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

/**
 * peek 只看不领:返回本 Agent 的全部 pending 行,不占租约不改变状态。
 * aw-node 调度器预检用;Agent 正常领取走 claimPendingForAgent。
 */
export async function listPendingForAgent(
  db: Db,
  agentId: string,
): Promise<WorkerInboxRecord[]> {
  return (await db.all(
    `SELECT ${FULL_COLUMNS} FROM worker_inbox
      WHERE target_agent_id = ? AND status = 'pending'
      ORDER BY created_at ASC, id ASC`,
    agentId,
  )) as WorkerInboxRecord[];
}

/** 首跳挂起的行:租约 token 进播报幂等键,同一行每个重投周期各播一次 */
export interface HeldInboxRow {
  id: string;
  leaseToken: number;
}

/**
 * 派发闸门挂起(M3.10,dispatch-coordination.md §3.1.5):collector 上报原因写 pending 行。
 * 只写 NULL→值的首跳,由该转换承担「首次挂起」判定;领取时清空,重投后可再挂。
 */
export async function markHeldForAgent(
  db: Db,
  agentId: string,
  reason: string,
  now: number,
): Promise<HeldInboxRow[]> {
  return (await db.all(
    `UPDATE worker_inbox
        SET reason = ?, updated_at = ?
      WHERE target_agent_id = ? AND status = 'pending' AND reason IS NULL
      RETURNING id, lease_token AS "leaseToken"`,
    reason,
    now,
    agentId,
  )) as HeldInboxRow[];
}

/**
 * claimed → acked:Assignment ACK 携带承接 Task;Input 仅消费。CAS 失败=租约过期已重投
 */
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

/** 僵尸回收重排(M3.10-4):最新一条已承接(acked)的 assignment 行 */
export async function findLatestAckedAssignment(
  db: Db,
  workItemId: string,
): Promise<WorkerInboxRecord | undefined> {
  return (await db.get(
    `SELECT ${FULL_COLUMNS} FROM worker_inbox
      WHERE work_item_id = ? AND kind = 'assignment' AND status = 'acked'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    workItemId,
  )) as WorkerInboxRecord | undefined;
}

/** acked → pending 重排:清租约与旧任务绑定,task_id 留空待新承接重新绑定 */
export async function requeueAckedAssignment(db: Db, id: string, now: number): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE worker_inbox
            SET status = 'pending', lease_token = lease_token + 1, lease_until = NULL,
                task_id = NULL, updated_at = ?
          WHERE id = ? AND status = 'acked'`,
        now,
        id,
      )
    ).changes === 1
  );
}

/**
 * 派工停滞(M3.10-4):pending 超过时限的 assignment 所属事项 id(去重)。
 * 以 updated_at 而非 created_at 计时:重排、被领取退回、挂起都会刷新 updated_at,
 * 用 created_at 会把刚重排回 pending 的行按原始创建时间判成停滞。
 */
export async function listStalePendingWorkItemIds(db: Db, updatedBefore: number): Promise<string[]> {
  const rows = (await db.all(
    `SELECT DISTINCT work_item_id AS id FROM worker_inbox
      WHERE status = 'pending' AND updated_at <= ?`,
    updatedBefore,
  )) as { id: string }[];
  return rows.map((row) => row.id);
}

/** Agent 是否持有该事项的有效 assignment(claimed/acked):建关联任务的前置(arch/02 §3.1) */
export async function hasActiveAssignment(
  db: Db,
  workItemId: string,
  agentId: string,
): Promise<boolean> {
  const row = await db.get(
    `SELECT 1 FROM worker_inbox
      WHERE work_item_id = ? AND target_agent_id = ? AND kind = 'assignment'
        AND status IN ('claimed', 'acked') LIMIT 1`,
    workItemId,
    agentId,
  );
  return row !== undefined;
}

/** work_read 的读权限:inbox 有指向该 Agent 的未退回行(知道 ID 不等于有权读) */
export async function hasOpenInboxForAgent(
  db: Db,
  workItemId: string,
  agentId: string,
): Promise<boolean> {
  const row = await db.get(
    `SELECT 1 FROM worker_inbox
      WHERE work_item_id = ? AND target_agent_id = ? AND status IN ('pending', 'claimed', 'acked')
      LIMIT 1`,
    workItemId,
    agentId,
  );
  return row !== undefined;
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
