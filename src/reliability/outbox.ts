import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../store/database.js";
import { insertOutbox, type OutboxRecord } from "../store/repositories/outbox.js";

/** push 通道落地载荷:目标会话 + 卡片 JSON,worker 只按此投递,不感知业务 */
export interface OutboxPushPayload {
  chatId: string;
  card: unknown;
}

export interface EnqueuePushInput {
  idempotencyKey: string;
  kind: string;
  taskId?: string | null;
  chatId: string;
  card: unknown;
  now?: number;
}

function newOutboxId(): string {
  return `ob_${randomBytes(8).toString("hex")}`;
}

/** 入队一条飞书推送(notification 类,失败只重试);同幂等键只保留首条 */
export function enqueuePush(db: Db, input: EnqueuePushInput): OutboxRecord {
  const payload: OutboxPushPayload = { chatId: input.chatId, card: input.card };
  const payloadJson = JSON.stringify(payload);
  const now = input.now ?? Date.now();
  return insertOutbox(db, {
    id: newOutboxId(),
    idempotencyKey: input.idempotencyKey,
    channel: "push",
    deliveryClass: "notification",
    taskId: input.taskId ?? null,
    msgId: null,
    kind: input.kind,
    payloadHash: createHash("sha256").update(payloadJson).digest("hex"),
    payloadJson,
    availableAt: now,
    createdAt: now,
  });
}
