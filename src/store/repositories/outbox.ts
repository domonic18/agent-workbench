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
  id, idempotency_key AS idempotencyKey, channel, delivery_class AS deliveryClass,
  task_id AS taskId, msg_id AS msgId, kind, payload_hash AS payloadHash,
  payload_json AS payloadJson, status, attempts, lease_token AS leaseToken,
  lease_until AS leaseUntil, available_at AS availableAt, last_error AS lastError,
  created_at AS createdAt
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

export function findOutbox(db: Db, id: string): OutboxRecord | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM outbox WHERE id = ?`).get(id) as
    | OutboxRecord
    | undefined;
}

export function findOutboxByKey(db: Db, idempotencyKey: string): OutboxRecord | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM outbox WHERE idempotency_key = ?`).get(idempotencyKey) as
    | OutboxRecord
    | undefined;
}

/** 幂等入队:同 idempotency_key 只保留首条,重复调用返回已有记录 */
export function insertOutbox(db: Db, row: NewOutbox): OutboxRecord {
  db.prepare(
    `INSERT OR IGNORE INTO outbox
       (id, idempotency_key, channel, delivery_class, task_id, msg_id, kind,
        payload_hash, payload_json, status, attempts, lease_token, available_at, created_at)
     VALUES (@id, @idempotencyKey, @channel, @deliveryClass, @taskId, @msgId, @kind,
        @payloadHash, @payloadJson, 'pending', 0, 0, @availableAt, @createdAt)`,
  ).run(row);
  const stored = findOutboxByKey(db, row.idempotencyKey);
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
export function claimDue(
  db: Db,
  now: number,
  leaseUntil: number,
  channel: OutboxChannel = "push",
): OutboxRecord | undefined {
  const candidate = db
    .prepare(
      `SELECT id FROM outbox
       WHERE channel = @channel AND status IN ('pending', 'retry_wait') AND available_at <= @now
       ORDER BY available_at ASC LIMIT 1`,
    )
    .get({ channel, now }) as { id: string } | undefined;
  if (candidate === undefined) {
    return undefined;
  }
  const claimed = db
    .prepare(
      `UPDATE outbox
       SET status = 'claimed', lease_token = lease_token + 1, lease_until = ?, attempts = attempts + 1
       WHERE id = ? AND status IN ('pending', 'retry_wait')`,
    )
    .run(leaseUntil, candidate.id);
  if (claimed.changes !== 1) {
    return undefined;
  }
  return findOutbox(db, candidate.id);
}

function finish(
  db: Db,
  where: string,
  params: Record<string, unknown>,
): boolean {
  const result = db
    .prepare(`UPDATE outbox SET ${where} WHERE id = @id AND lease_token = @leaseToken`)
    .run(params);
  return result.changes === 1;
}

/** claimed → sending:进入同步发送后租约过期不能再静默重放,由 uncertain 围栏接管 */
export function markSending(db: Db, id: string, leaseToken: number): boolean {
  return (
    db
      .prepare(
        "UPDATE outbox SET status = 'sending' WHERE id = @id AND lease_token = @leaseToken AND status = 'claimed'",
      )
      .run({ id, leaseToken }).changes === 1
  );
}

/** sending → uncertain:发送结果未知,业务类任务据此围栏,不自动重放 */
export function markUncertain(db: Db, id: string, leaseToken: number): boolean {
  return (
    db
      .prepare(
        "UPDATE outbox SET status = 'uncertain', lease_until = NULL WHERE id = @id AND lease_token = @leaseToken AND status = 'sending'",
      )
      .run({ id, leaseToken }).changes === 1
  );
}

/** ACK 路径:按 msg_id 把出箱标记为 delivered,不依赖当前租约 token */
export function markDeliveredByMsgId(db: Db, msgId: string): boolean {
  return (
    db
      .prepare(
        `UPDATE outbox SET status = 'delivered', lease_until = NULL, last_error = NULL
         WHERE msg_id = ? AND status IN ('pending', 'claimed', 'sending', 'retry_wait')`,
      )
      .run(msgId).changes > 0
  );
}

/** 信箱拉取:按 msg_id 领取一条可见消息,与 claimDue 同一套租约语义 */
export function claimPullByMsgId(
  db: Db,
  msgId: string,
  now: number,
  leaseUntil: number,
): OutboxRecord | undefined {
  const candidate = db
    .prepare(
      `SELECT id FROM outbox
       WHERE msg_id = ? AND channel = 'pull' AND status IN ('pending', 'retry_wait') AND available_at <= ?
       ORDER BY available_at ASC LIMIT 1`,
    )
    .get(msgId, now) as { id: string } | undefined;
  if (candidate === undefined) {
    return undefined;
  }
  const claimed = db
    .prepare(
      `UPDATE outbox
       SET status = 'claimed', lease_token = lease_token + 1, lease_until = ?, attempts = attempts + 1
       WHERE id = ? AND status IN ('pending', 'retry_wait')`,
    )
    .run(leaseUntil, candidate.id);
  if (claimed.changes !== 1) {
    return undefined;
  }
  return findOutbox(db, candidate.id);
}

/** 业务投递围栏:该任务存在 uncertain 的 business 出箱行时,冻结新的 A2A 发送 */
export function findUncertainFence(db: Db, taskId: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM outbox
         WHERE task_id = ? AND delivery_class = 'business' AND status = 'uncertain' LIMIT 1`,
      )
      .get(taskId) !== undefined
  );
}

export function markDelivered(db: Db, id: string, leaseToken: number): boolean {
  return finish(db, "status = 'delivered', lease_until = NULL, last_error = NULL", {
    id,
    leaseToken,
  });
}

export function markRetry(
  db: Db,
  id: string,
  leaseToken: number,
  availableAt: number,
  lastError: string,
): boolean {
  return finish(
    db,
    "status = 'retry_wait', lease_until = NULL, available_at = @availableAt, last_error = @lastError",
    { id, leaseToken, availableAt, lastError },
  );
}

export function markFailed(db: Db, id: string, leaseToken: number, lastError: string): boolean {
  return finish(db, "status = 'failed', lease_until = NULL, last_error = @lastError", {
    id,
    leaseToken,
    lastError,
  });
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
export function reconcileStaleLeases(db: Db, now: number): ReconcileOutcome {
  const retryWait = db
    .prepare(
      `UPDATE outbox SET status = 'retry_wait', lease_until = NULL, available_at = ?
       WHERE status = 'claimed' AND lease_until IS NOT NULL AND lease_until < ?`,
    )
    .run(now, now).changes;
  const uncertain = db
    .prepare(
      `UPDATE outbox SET status = 'uncertain', lease_until = NULL
       WHERE status = 'sending' AND lease_until IS NOT NULL AND lease_until < ?`,
    )
    .run(now).changes;
  return { retryWait, uncertain };
}
