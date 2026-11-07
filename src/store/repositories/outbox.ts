import type { OutboxChannel, OutboxDeliveryClass, OutboxStatus } from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface OutboxRecord {
  id: string;
  idempotencyKey: string;
  channel: OutboxChannel;
  deliveryClass: OutboxDeliveryClass;
  taskId: string | null;
  msgId: string | null;
  kind: string;
  payloadHash: string;
  payloadJson: string;
  status: OutboxStatus;
  attempts: number;
  leaseToken: number;
  leaseUntil: number | null;
  availableAt: number;
  lastError: string | null;
  createdAt: number;
}

const COLUMNS = `
  id, idempotency_key AS "idempotencyKey", channel, delivery_class AS "deliveryClass",
  task_id AS "taskId", msg_id AS "msgId", kind, payload_hash AS "payloadHash",
  payload_json AS "payloadJson", status, attempts, lease_token AS "leaseToken",
  lease_until AS "leaseUntil", available_at AS "availableAt", last_error AS "lastError",
  created_at AS "createdAt"
`;

export interface NewOutbox {
  id: string;
  idempotencyKey: string;
  channel: OutboxChannel;
  deliveryClass: OutboxDeliveryClass;
  taskId: string | null;
  msgId: string | null;
  kind: string;
  payloadHash: string;
  payloadJson: string;
  availableAt: number;
  createdAt: number;
}

export async function findOutbox(db: Db, id: string): Promise<OutboxRecord | undefined> {
  return (await db.get(`SELECT ${COLUMNS} FROM outbox WHERE id = ?`, id)) as
    | OutboxRecord
    | undefined;
}

export async function findOutboxByKey(db: Db, idempotencyKey: string): Promise<OutboxRecord | undefined> {
  return (await db.get(
    `SELECT ${COLUMNS} FROM outbox WHERE idempotency_key = ?`,
    idempotencyKey,
  )) as OutboxRecord | undefined;
}

/** 幂等入队:同 idempotency_key 只保留首条,重复调用返回已有记录 */
export async function insertOutbox(db: Db, row: NewOutbox): Promise<OutboxRecord> {
  await db.run(
    `INSERT INTO outbox
       (id, idempotency_key, channel, delivery_class, task_id, msg_id, kind,
        payload_hash, payload_json, status, attempts, lease_token, available_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?)
  ON CONFLICT (idempotency_key) DO NOTHING`,
    row.id, row.idempotencyKey, row.channel, row.deliveryClass, row.taskId,
    row.msgId, row.kind, row.payloadHash, row.payloadJson, row.availableAt, row.createdAt,
  );
  const stored = await findOutboxByKey(db, row.idempotencyKey);
  if (stored === undefined) {
    throw new Error(`outbox 入队后读不到记录: ${row.idempotencyKey}`);
  }
  return stored;
}

/**
 * 领取一条到期记录(01 §6):pending / retry_wait 且在 available_at 之后到期。
 * 单进程串行调用下 select + 条件更新无并发窗口;租约 token 单调递增,过期租约不能提交结果。
 * 必须按 channel 领取:push worker 不能误领 pull(A2A 信箱)行。
 */
export async function claimDue(
  db: Db,
  now: number,
  leaseUntil: number,
  channel: OutboxChannel = "push",
): Promise<OutboxRecord | undefined> {
  const candidate = (await db.get(
    `SELECT id FROM outbox
     WHERE channel = ? AND status IN ('pending', 'retry_wait') AND available_at <= ?
     ORDER BY available_at ASC LIMIT 1`,
    channel, now,
  )) as { id: string } | undefined;
  if (candidate === undefined) {
    return undefined;
  }
  const claimed = await db.run(
    `UPDATE outbox
     SET status = 'claimed', lease_token = lease_token + 1, lease_until = ?, attempts = attempts + 1
     WHERE id = ? AND status IN ('pending', 'retry_wait')`,
    leaseUntil, candidate.id,
  );
  if (claimed.changes !== 1) {
    return undefined;
  }
  return findOutbox(db, candidate.id);
}

async function finish(
  db: Db,
  setClause: string,
  params: unknown[],
  id: string,
  leaseToken: number,
): Promise<boolean> {
  const result = await db.run(
    `UPDATE outbox SET ${setClause} WHERE id = ? AND lease_token = ?`,
    ...params, id, leaseToken,
  );
  return result.changes === 1;
}

/** claimed → sending:进入同步发送后租约过期不能再静默重放,由 uncertain 围栏接管 */
export async function markSending(db: Db, id: string, leaseToken: number): Promise<boolean> {
  return (
    (
      await db.run(
        "UPDATE outbox SET status = 'sending' WHERE id = ? AND lease_token = ? AND status = 'claimed'",
        id, leaseToken,
      )
    ).changes === 1
  );
}

/** sending → uncertain:发送结果未知,业务类任务据此围栏,不自动重放 */
export async function markUncertain(db: Db, id: string, leaseToken: number): Promise<boolean> {
  return (
    (
      await db.run(
        "UPDATE outbox SET status = 'uncertain', lease_until = NULL WHERE id = ? AND lease_token = ? AND status = 'sending'",
        id, leaseToken,
      )
    ).changes === 1
  );
}

/**
 * 死信路径:按 msg_id 把未终结的出箱行置 failed(01 §9)。
 * 与 ACK 的 delivered 互斥——谁先到谁生效,后到者 CAS 失败。
 */
export async function markFailedByMsgId(db: Db, msgId: string, lastError: string): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE outbox SET status = 'failed', lease_until = NULL, last_error = ?
         WHERE msg_id = ? AND status IN ('pending', 'claimed', 'sending', 'retry_wait')`,
        lastError, msgId,
      )
    ).changes > 0
  );
}

/** ACK 路径:按 msg_id 把出箱标记为 delivered,不依赖当前租约 token */
export async function markDeliveredByMsgId(db: Db, msgId: string): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE outbox SET status = 'delivered', lease_until = NULL, last_error = NULL
         WHERE msg_id = ? AND status IN ('pending', 'claimed', 'sending', 'retry_wait')`,
        msgId,
      )
    ).changes > 0
  );
}

/** 信箱拉取:按 msg_id 领取一条可见消息,与 claimDue 同一套租约语义 */
export async function claimPullByMsgId(
  db: Db,
  msgId: string,
  now: number,
  leaseUntil: number,
): Promise<OutboxRecord | undefined> {
  const candidate = (await db.get(
    `SELECT id FROM outbox
     WHERE msg_id = ? AND channel = 'pull' AND status IN ('pending', 'retry_wait') AND available_at <= ?
     ORDER BY available_at ASC LIMIT 1`,
    msgId, now,
  )) as { id: string } | undefined;
  if (candidate === undefined) {
    return undefined;
  }
  const claimed = await db.run(
    `UPDATE outbox
     SET status = 'claimed', lease_token = lease_token + 1, lease_until = ?, attempts = attempts + 1
     WHERE id = ? AND status IN ('pending', 'retry_wait')`,
    leaseUntil, candidate.id,
  );
  if (claimed.changes !== 1) {
    return undefined;
  }
  return findOutbox(db, candidate.id);
}

/** 业务投递围栏:该任务存在 uncertain 的 business 出箱行时,冻结新的 A2A 发送 */
export async function findUncertainFence(db: Db, taskId: string): Promise<boolean> {
  return (
    (await db.get(
      `SELECT 1 FROM outbox
       WHERE task_id = ? AND delivery_class = 'business' AND status = 'uncertain' LIMIT 1`,
      taskId,
    )) !== undefined
  );
}

export async function markDelivered(db: Db, id: string, leaseToken: number): Promise<boolean> {
  return finish(
    db,
    "status = 'delivered', lease_until = NULL, last_error = NULL",
    [],
    id,
    leaseToken,
  );
}

export async function markRetry(
  db: Db,
  id: string,
  leaseToken: number,
  availableAt: number,
  lastError: string,
): Promise<boolean> {
  return finish(
    db,
    "status = 'retry_wait', lease_until = NULL, available_at = ?, last_error = ?",
    [availableAt, lastError],
    id,
    leaseToken,
  );
}

export async function markFailed(db: Db, id: string, leaseToken: number, lastError: string): Promise<boolean> {
  return finish(db, "status = 'failed', lease_until = NULL, last_error = ?", [lastError], id, leaseToken);
}

export interface ReconcileOutcome {
  /** 未进入发送的过期租约,可安全重投 */
  retryWait: number;
  /** 已进入发送的过期租约,结果未知,转 uncertain 等人工处置 */
  uncertain: number;
}

/**
 * 租约过期回收(01 §6.5):claimed → retry_wait 可重投;sending → uncertain 不自动重放。
 * pull 通道以 ACK 为判据,被拉走但未 ACK 的消息同样按 claimed 回收后重新可见。
 */
export async function reconcileStaleLeases(db: Db, now: number): Promise<ReconcileOutcome> {
  const retryWait = (
    await db.run(
      `UPDATE outbox SET status = 'retry_wait', lease_until = NULL, available_at = ?
       WHERE status = 'claimed' AND lease_until IS NOT NULL AND lease_until < ?`,
      now, now,
    )
  ).changes;
  const uncertain = (
    await db.run(
      `UPDATE outbox SET status = 'uncertain', lease_until = NULL
       WHERE status = 'sending' AND lease_until IS NOT NULL AND lease_until < ?`,
      now,
    )
  ).changes;
  return { retryWait, uncertain };
}
