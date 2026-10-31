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
 */
export function claimDue(db: Db, now: number, leaseUntil: number): OutboxRecord | undefined {
  const candidate = db
    .prepare(
      `SELECT id FROM outbox
       WHERE status IN ('pending', 'retry_wait') AND available_at <= ?
       ORDER BY available_at ASC LIMIT 1`,
    )
    .get(now) as { id: string } | undefined;
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

/** 租约过期回收(01 §6.5):未进入发送的 claimed 回 retry_wait,由下一轮重新领取 */
export function reconcileStaleLeases(db: Db, now: number): number {
  const result = db
    .prepare(
      `UPDATE outbox SET status = 'retry_wait', lease_until = NULL, available_at = ?
       WHERE status = 'claimed' AND lease_until IS NOT NULL AND lease_until < ?`,
    )
    .run(now, now);
  return result.changes;
}
