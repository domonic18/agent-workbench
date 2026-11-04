import { createHash } from "node:crypto";
import { newPrefixedId } from "../shared/ids.js";
import type { Db } from "../store/database.js";
import { insertOutbox, type OutboxRecord } from "../store/repositories/outbox.js";

/** push 通道落地载荷:审批卡片或纯文本播报(带 uuid 供飞书侧去重),worker 只按此投递,不感知业务 */
export interface OutboxPushPayload {
  chatId: string;
  card?: unknown;
  text?: string;
  uuid?: string;
}

export interface EnqueuePushInput {
  idempotencyKey: string;
  kind: string;
  taskId?: string | null;
  chatId: string;
  /** 卡片与文本二选一;text 用于协作群播报,uuid 透传飞书做幂等去重 */
  card?: unknown;
  text?: string;
  uuid?: string;
  now?: number;
}

export interface EnqueuePullInput {
  /** 客户端 Idempotency-Key 原样入库,重复发送直接返回首条 */
  idempotencyKey: string;
  kind: string;
  taskId: string;
  msgId: string;
  /** 落地信封 JSON,对端拉取时原样返回 */
  payloadJson: string;
  now?: number;
}

/** 入队一条飞书推送(notification 类,失败只重试);同幂等键只保留首条 */
export async function enqueuePush(db: Db, input: EnqueuePushInput): Promise<OutboxRecord> {
  const payload: OutboxPushPayload = {
    chatId: input.chatId,
    ...(input.card === undefined ? {} : { card: input.card }),
    ...(input.text === undefined ? {} : { text: input.text }),
    ...(input.uuid === undefined ? {} : { uuid: input.uuid }),
  };
  const payloadJson = JSON.stringify(payload);
  const now = input.now ?? Date.now();
  return await insertOutbox(db, {
    id: newPrefixedId("ob"),
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

/**
 * 入队一条 A2A 信箱消息(business 类,pull 通道):只有对端 ACK 才算 delivered,
 * 失败不重试、不推进 round;拉取不产生 uncertain。
 */
export async function enqueuePull(db: Db, input: EnqueuePullInput): Promise<OutboxRecord>{
  const now = input.now ?? Date.now();
  return await insertOutbox(db, {
    id: newPrefixedId("ob"),
    idempotencyKey: input.idempotencyKey,
    channel: "pull",
    deliveryClass: "business",
    taskId: input.taskId,
    msgId: input.msgId,
    kind: input.kind,
    payloadHash: createHash("sha256").update(input.payloadJson).digest("hex"),
    payloadJson: input.payloadJson,
    availableAt: now,
    createdAt: now,
  });
}
