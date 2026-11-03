import type { RunStatus } from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface AgentRunRecord {
  id: string;
  agentId: string;
  machine: string;
  project: string;
  streamId: string;
  taskId: string | null;
  status: RunStatus;
  startedAt: number;
  lastSeenAt: number;
  endedAt: number | null;
}

const RUN_COLUMNS = `
  id, agent_id AS agentId, machine, project, stream_id AS streamId,
  task_id AS taskId, status, started_at AS startedAt, last_seen_at AS lastSeenAt,
  ended_at AS endedAt
`;

export interface NewAgentRun {
  id: string;
  agentId: string;
  machine: string;
  project: string;
  streamId: string;
  startedAt: number;
}

export function insertRun(db: Db, run: NewAgentRun): void {
  db.prepare(
    `INSERT INTO agent_run
       (id, agent_id, machine, project, stream_id, task_id, status,
        started_at, last_seen_at, ended_at)
     VALUES (@id, @agentId, @machine, @project, @streamId, NULL, 'running',
             @startedAt, @startedAt, NULL
  ON CONFLICT DO NOTHING)`,
  ).run(run);
}

export async function findRunById(db: Db, id: string): Promise<AgentRunRecord | undefined>{
  return await db.get(`SELECT ${RUN_COLUMNS} FROM agent_run WHERE id = ?`, id) as
    | AgentRunRecord
    | undefined;
}

/** 部分唯一索引保证每个流至多一条 running,这里只取最新的一条 */
export function findRunningRunForStream(
  db: Db,
  agentId: string,
  streamId: string,
): AgentRunRecord | undefined {
  return db
    .prepare(
      `SELECT ${RUN_COLUMNS} FROM agent_run
       WHERE agent_id = ? AND stream_id = ? AND status = 'running'
       ORDER BY last_seen_at DESC, id DESC LIMIT 1`,
    )
    .get(agentId, streamId) as AgentRunRecord | undefined;
}

/** 晚到事件不得回拨 last_seen_at:调用方传入 max(当前值, 事件时间) */
export function touchRunLastSeen(db: Db, id: string, lastSeenAt: number): boolean {
  return (
    db
      .prepare(
        "UPDATE agent_run SET last_seen_at = ? WHERE id = ? AND status = 'running' AND last_seen_at <= ?",
      )
      .run(lastSeenAt, id, lastSeenAt).changes === 1
  );
}

export function endRun(db: Db, id: string, endedAt: number): boolean {
  return (
    db
      .prepare(
        "UPDATE agent_run SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'running'",
      )
      .run(endedAt, id).changes === 1
  );
}

/**
 * 当前 Agent 最近活跃且尚未归属任务的 running run。
 * 建单时用它把「谁干活谁建单」落到具体 run 上;空闲超过窗口的 run 不算。
 */
export function findLatestUnboundRunningRunByAgent(
  db: Db,
  agentId: string,
  activeSince: number,
): AgentRunRecord | undefined {
  return db
    .prepare(
      `SELECT ${RUN_COLUMNS} FROM agent_run
       WHERE agent_id = ? AND status = 'running' AND task_id IS NULL AND last_seen_at >= ?
       ORDER BY last_seen_at DESC, id DESC LIMIT 1`,
    )
    .get(agentId, activeSince) as AgentRunRecord | undefined;
}

/** 一个 run 至多归属一条任务:首次绑定后不可覆盖(02 §3.1) */
export function bindRunTaskIfEmpty(db: Db, id: string, taskId: string): boolean {
  return (
    db
      .prepare("UPDATE agent_run SET task_id = ? WHERE id = ? AND task_id IS NULL")
      .run(taskId, id).changes === 1
  );
}

export interface TimelineEventRecord {
  id: string;
  runId: string;
  turnId: string | null;
  blockId: string | null;
  ord: number;
  blockRev: number;
  offset: number | null;
  kind: string;
  payloadJson: string;
  occurredAt: number;
}

const TIMELINE_COLUMNS = `
  id, run_id AS runId, turn_id AS turnId, block_id AS blockId, ord,
  block_rev AS blockRev, "offset" AS "offset", kind, payload_json AS payloadJson,
  occurred_at AS occurredAt
`;

export interface NewTimelineEvent {
  id: string;
  runId: string;
  turnId: string | null;
  blockId: string | null;
  ord: number;
  blockRev: number;
  offset: number | null;
  kind: string;
  payload: unknown;
  occurredAt: number;
}

export function insertTimelineEvent(db: Db, event: NewTimelineEvent): void {
  db.prepare(
    `INSERT INTO timeline_event
       (id, run_id, turn_id, block_id, ord, block_rev, "offset", kind, payload_json, occurred_at)
     VALUES (@id, @runId, @turnId, @blockId, @ord, @blockRev, @offset, @kind, @payloadJson,
             @occurredAt
  ON CONFLICT DO NOTHING)`,
  ).run({
    id: event.id,
    runId: event.runId,
    turnId: event.turnId,
    blockId: event.blockId,
    ord: event.ord,
    blockRev: event.blockRev,
    offset: event.offset,
    kind: event.kind,
    payloadJson: JSON.stringify(event.payload ?? {}),
    occurredAt: event.occurredAt,
  });
}

/** 块内当前新鲜度;没有该块的旧事件时返回 0,便于统一比较 */
export function maxBlockRev(db: Db, runId: string, blockId: string): number {
  const row = db
    .prepare(
      "SELECT COALESCE(MAX(block_rev), 0) AS blockRev FROM timeline_event WHERE run_id = ? AND block_id = ?",
    )
    .get(runId, blockId) as { blockRev: number };
  return row.blockRev;
}

export function listTimelineEventsByRun(db: Db, runId: string): TimelineEventRecord[] {
  return db
    .prepare(
      `SELECT ${TIMELINE_COLUMNS} FROM timeline_event
       WHERE run_id = ? ORDER BY occurred_at ASC, ord ASC, id ASC`,
    )
    .all(runId) as TimelineEventRecord[];
}
