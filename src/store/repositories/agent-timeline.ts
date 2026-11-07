import type { Db } from "../database.js";
import { parseJsonObject } from "../json.js";

/**
 * Agent 对话流事件:timeline_event 与 agent_run 联表的一行。
 * payload 是服务端解析后的对象,前端不接触裸 jsonb 文本。
 */
export interface AgentTimelineRow {
  id: string;
  runId: string;
  runProject: string;
  runMachine: string;
  kind: string;
  occurredAt: number;
  payload: Record<string, unknown>;
}

export interface AgentTimelineQuery {
  agentId: string;
  limit: number;
  /** 游标上界:(occurredAt, id) 之前的事件 */
  before?: { occurredAt: number; id: string };
}

/**
 * 按时间倒序取该 Agent 最近的事件(游标向前翻更早的)。
 * timeline_event 只能经 agent_run 关联到 Agent——事件本身不记 agent_id。
 */
export async function listTimelineEventsByAgent(
  db: Db,
  query: AgentTimelineQuery,
): Promise<AgentTimelineRow[]> {
  const params: unknown[] = [query.agentId];
  let before = "";
  if (query.before !== undefined) {
    before = "AND (te.occurred_at, te.id) < (?, ?)";
    params.push(query.before.occurredAt, query.before.id);
  }
  params.push(query.limit);
  const rows = (await db.all(
    `SELECT te.id, te.run_id AS "runId", te.kind, te.occurred_at AS "occurredAt",
            te.payload_json AS "payloadJson",
            ar.project AS "runProject", ar.machine AS "runMachine"
       FROM timeline_event te
       JOIN agent_run ar ON ar.id = te.run_id
      WHERE ar.agent_id = ? ${before}
      ORDER BY te.occurred_at DESC, te.id DESC
      LIMIT ?`,
    ...params,
  )) as { id: string; runId: string; runProject: string; runMachine: string; kind: string; occurredAt: number; payloadJson: string }[];

  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    runProject: row.runProject,
    runMachine: row.runMachine,
    kind: row.kind,
    occurredAt: row.occurredAt,
    payload: parseJsonObject(row.payloadJson),
  }));
}
