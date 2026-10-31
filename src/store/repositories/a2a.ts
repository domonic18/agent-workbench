import type { A2AIntent } from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface A2aThreadRecord {
  id: string;
  initiatorTaskId: string;
  initiatorAgent: string;
  responderAgent: string;
  createdAt: number;
}

const THREAD_COLUMNS = `
  id, initiator_task_id AS initiatorTaskId, initiator_agent AS initiatorAgent,
  responder_agent AS responderAgent, created_at AS createdAt
`;

export interface NewA2aThread {
  id: string;
  initiatorTaskId: string;
  initiatorAgent: string;
  responderAgent: string;
  createdAt: number;
}

export function insertThread(db: Db, row: NewA2aThread): void {
  db.prepare(
    `INSERT INTO a2a_thread
       (id, initiator_task_id, initiator_agent, responder_agent, created_at)
     VALUES (@id, @initiatorTaskId, @initiatorAgent, @responderAgent, @createdAt)`,
  ).run(row);
}

export function findThreadById(db: Db, id: string): A2aThreadRecord | undefined {
  return db.prepare(`SELECT ${THREAD_COLUMNS} FROM a2a_thread WHERE id = ?`).get(id) as
    | A2aThreadRecord
    | undefined;
}

export function findThreadByInitiator(
  db: Db,
  initiatorTaskId: string,
  responderAgent: string,
): A2aThreadRecord | undefined {
  return db
    .prepare(
      `SELECT ${THREAD_COLUMNS} FROM a2a_thread
       WHERE initiator_task_id = ? AND responder_agent = ?`,
    )
    .get(initiatorTaskId, responderAgent) as A2aThreadRecord | undefined;
}

export interface A2aMessageRecord {
  id: string;
  threadId: string;
  taskId: string;
  round: number;
  replyToMsgId: string | null;
  fromAgent: string;
  toAgent: string;
  intent: A2AIntent;
  summary: string;
  expect: string;
  deadlineAt: number | null;
  refsJson: string;
  authTicket: string | null;
  ackAt: number | null;
  createdAt: number;
}

const MESSAGE_COLUMNS = `
  id, thread_id AS threadId, task_id AS taskId, round,
  reply_to_msg_id AS replyToMsgId, from_agent AS fromAgent, to_agent AS toAgent,
  intent, summary, expect, deadline_at AS deadlineAt, refs_json AS refsJson,
  auth_ticket AS authTicket, ack_at AS ackAt, created_at AS createdAt
`;

export interface NewA2aMessage {
  id: string;
  threadId: string;
  taskId: string;
  round: number;
  replyToMsgId: string | null;
  fromAgent: string;
  toAgent: string;
  intent: A2AIntent;
  summary: string;
  expect: string;
  deadlineAt: number | null;
  refsJson: string;
  authTicket: string | null;
  createdAt: number;
}

export function insertMessage(db: Db, row: NewA2aMessage): void {
  db.prepare(
    `INSERT INTO a2a_message
       (id, thread_id, task_id, round, reply_to_msg_id, from_agent, to_agent, intent,
        summary, expect, deadline_at, refs_json, auth_ticket, created_at)
     VALUES (@id, @threadId, @taskId, @round, @replyToMsgId, @fromAgent, @toAgent, @intent,
        @summary, @expect, @deadlineAt, @refsJson, @authTicket, @createdAt)`,
  ).run(row);
}

export function findMessageById(db: Db, id: string): A2aMessageRecord | undefined {
  return db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM a2a_message WHERE id = ?`).get(id) as
    | A2aMessageRecord
    | undefined;
}

export function maxRound(db: Db, threadId: string): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(round), 0) AS round FROM a2a_message WHERE thread_id = ?")
    .get(threadId) as { round: number };
  return row.round;
}

export function markAck(db: Db, id: string, now: number): boolean {
  return (
    db
      .prepare("UPDATE a2a_message SET ack_at = @now WHERE id = @id AND ack_at IS NULL")
      .run({ id, now }).changes === 1
  );
}

export interface A2aDeadLetterRecord {
  id: string;
  msgId: string;
  fromAgent: string;
  toAgent: string;
  taskId: string | null;
  reason: string;
  payloadJson: string;
  createdAt: number;
}

export interface NewA2aDeadLetter {
  id: string;
  msgId: string;
  fromAgent: string;
  toAgent: string;
  taskId: string | null;
  reason: string;
  payloadJson: string;
  createdAt: number;
}

const DEAD_LETTER_COLUMNS = `
  id, msg_id AS msgId, from_agent AS fromAgent, to_agent AS toAgent,
  task_id AS taskId, reason, payload_json AS payloadJson, created_at AS createdAt
`;

export function insertDeadLetter(db: Db, row: NewA2aDeadLetter): void {
  db.prepare(
    `INSERT INTO a2a_dead_letter
       (id, msg_id, from_agent, to_agent, task_id, reason, payload_json, created_at)
     VALUES (@id, @msgId, @fromAgent, @toAgent, @taskId, @reason, @payloadJson, @createdAt)`,
  ).run(row);
}

export function findDeadLetterByMsgId(db: Db, msgId: string): A2aDeadLetterRecord | undefined {
  return db
    .prepare(`SELECT ${DEAD_LETTER_COLUMNS} FROM a2a_dead_letter WHERE msg_id = ? LIMIT 1`)
    .get(msgId) as A2aDeadLetterRecord | undefined;
}

/**
 * 死信巡检候选(01 §9):deadline 已过、仍未 ACK、出箱尚未终结的消息。
 * notify 无 deadline,天然不在结果内。
 */
export function listExpiredUnacked(db: Db, now: number, limit: number): A2aMessageRecord[] {
  return db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM a2a_message
       WHERE deadline_at IS NOT NULL AND deadline_at <= @now AND ack_at IS NULL
         AND EXISTS (
           SELECT 1 FROM outbox o
           WHERE o.msg_id = a2a_message.id AND o.channel = 'pull'
             AND o.status IN ('pending', 'claimed', 'sending', 'retry_wait')
         )
       ORDER BY deadline_at ASC, id ASC LIMIT @limit`,
    )
    .all({ now, limit }) as A2aMessageRecord[];
}

export interface InboxQuery {
  /** 当前时间,用于判断 outbox 是否可见 */
  now: number;
  limit: number;
  /** keyset 游标:上一页最后一条的 (createdAt, id),升序 */
  after?: { createdAt: number; id: string };
}

/**
 * 只返回 `to` 为本人、未 ACK、且出箱行待领取/待重试的消息。
 * 被拉走但未 ACK 的行在租约过期后由 reconcileStaleLeases 回 retry_wait,重新可见。
 */
export function listInbox(db: Db, agentId: string, query: InboxQuery): A2aMessageRecord[] {
  const params: Record<string, unknown> = { agentId, now: query.now, limit: query.limit };
  let cursor = "";
  if (query.after !== undefined) {
    cursor =
      "AND (m.created_at > @afterCreatedAt OR (m.created_at = @afterCreatedAt AND m.id > @afterId))";
    params.afterCreatedAt = query.after.createdAt;
    params.afterId = query.after.id;
  }
  return db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM a2a_message
       WHERE id IN (
         SELECT m.id FROM a2a_message m
         JOIN outbox o ON o.msg_id = m.id AND o.channel = 'pull'
         WHERE m.to_agent = @agentId AND m.ack_at IS NULL
           AND o.status IN ('pending', 'retry_wait') AND o.available_at <= @now
           ${cursor}
       )
       ORDER BY created_at ASC, id ASC LIMIT @limit`,
    )
    .all(params) as A2aMessageRecord[];
}
