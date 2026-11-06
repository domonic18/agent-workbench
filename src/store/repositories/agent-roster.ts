import type { AgentRuntime, IdentityStatus } from "../../shared/constants.js";
import type { Db } from "../database.js";

/**
 * Agent 名册行:身份档案 + 从既有表聚合出来的用量与在办统计。
 * 与总览的活体状态(overview 作用域)互补——名册含停用 Agent,活体状态只含在跑的。
 */
export interface AgentRosterRow {
  id: string;
  machineId: string | null;
  runtime: AgentRuntime;
  project: string;
  displayName: string;
  key: string | null;
  status: IdentityStatus;
  feishuAppId: string | null;
  allowedTargetsJson: string;
  createdAt: number;
  updatedAt: number;
  machineHostname: string | null;
  /** 累计运行次数 */
  totalRuns: number;
  /** 累计 token(含缓存读写) */
  totalTokens: number;
  /** 未收口任务数:assignee 是本 Agent 且任务未 done/cancelled */
  openTasks: number;
  lastRunAt: number | null;
}

const ROSTER_COLUMNS = `
  a.id, a.machine_id AS "machineId", a.runtime, a.project,
  a.display_name AS "displayName", a.key, a.status,
  a.feishu_app_id AS "feishuAppId",
  a.allowed_targets_json AS "allowedTargetsJson",
  a.created_at AS "createdAt", a.updated_at AS "updatedAt",
  m.hostname AS "machineHostname",
  COALESCE(r."totalRuns", 0) AS "totalRuns",
  COALESCE(tok."totalTokens", 0) AS "totalTokens",
  COALESCE(t."openTasks", 0) AS "openTasks",
  r."lastRunAt"
`;

export interface AgentRosterQuery {
  limit: number;
  /** keyset 游标:上一页最后一行的 (createdAt, id) */
  before?: { createdAt: number; id: string };
}

export async function listAgentRosterRows(
  db: Db,
  query: AgentRosterQuery,
): Promise<AgentRosterRow[]> {
  const params: unknown[] = [query.limit];
  let where = "";
  if (query.before !== undefined) {
    where = "WHERE a.created_at < $2 OR (a.created_at = $2 AND a.id < $3)";
    params.push(query.before.createdAt, query.before.id);
  }
  return (await db.all(
    `SELECT ${ROSTER_COLUMNS}
     FROM agent a
     LEFT JOIN machine m ON m.id = a.machine_id
     LEFT JOIN (
       SELECT agent_id, COUNT(*) AS "totalRuns", MAX(last_seen_at) AS "lastRunAt"
         FROM agent_run GROUP BY agent_id
     ) r ON r.agent_id = a.id
     LEFT JOIN (
       SELECT agent_id,
              SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens)
                AS "totalTokens"
         FROM token_usage GROUP BY agent_id
     ) tok ON tok.agent_id = a.id
     LEFT JOIN (
       SELECT assignee, COUNT(*) AS "openTasks"
         FROM task
        WHERE status IN ('pending', 'running', 'blocked', 'review')
        GROUP BY assignee
     ) t ON t.assignee = a.id
     ${where}
     ORDER BY a.created_at DESC, a.id DESC LIMIT $1`,
    ...params,
  )) as AgentRosterRow[];
}
