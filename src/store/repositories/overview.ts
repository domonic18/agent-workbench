import type { Db } from "../database.js";

export interface OverviewMetrics {
  runningAgents: number;
  runningTasks: number;
  todayTokens: number;
  pendingApprovals: number;
  heartbeatTimeouts: number;
}

export interface OverviewWindow {
  /** 今日 token 统计起点(本地日零点) */
  since: number;
  /** 运行 Agent 的存活窗口:last_seen_at 早于此值视为已停 */
  idleSince: number;
  /** 心跳超时阈值:last_seen_at 早于此值计为超时 */
  heartbeatSince: number;
}

/** 五项指标一次取回,避免前端为同一屏打多次接口 */
export function getOverviewMetrics(db: Db, window: OverviewWindow): OverviewMetrics {
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(DISTINCT r.agent_id)
            FROM agent_run r JOIN agent a ON a.id = r.agent_id
           WHERE r.status = 'running' AND r.last_seen_at >= @idleSince
             AND a.status = 'active') AS runningAgents,
         (SELECT COUNT(*) FROM task WHERE status = 'running') AS runningTasks,
         (SELECT COALESCE(SUM(
                   input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0)
            FROM token_usage WHERE occurred_at >= @since) AS todayTokens,
         (SELECT COUNT(*) FROM capability WHERE status = 'pending') AS pendingApprovals,
         (SELECT COUNT(*) FROM machine
           WHERE status = 'active' AND last_seen_at IS NOT NULL
             AND last_seen_at < @heartbeatSince) AS heartbeatTimeouts`,
    )
    .get(window) as OverviewMetrics;
}

export interface AgentOverviewRow {
  id: string;
  displayName: string;
  project: string;
  machineId: string;
  machineHostname: string;
  machineLastSeenAt: number | null;
  lastRunAt: number | null;
  running: number;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentTaskStage: string | null;
  currentTaskStatus: string | null;
  todayTokens: number;
}

export interface AgentOverviewWindow {
  since: number;
  idleSince: number;
}

/**
 * 一行一 Agent。当前任务取「最近一条仍存活的 running run」绑定的任务;
 * 空闲超过 RUN_IDLE_GAP_MS 的 run 不再算运行中(与指标口径一致)。
 */
export function listAgentOverviewRows(
  db: Db,
  window: AgentOverviewWindow,
): AgentOverviewRow[] {
  return db
    .prepare(
      `SELECT
         a.id,
         a.display_name AS displayName,
         a.project,
         a.machine_id AS machineId,
         m.hostname AS machineHostname,
         m.last_seen_at AS machineLastSeenAt,
         lr.lastRunAt,
         CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS running,
         r.task_id AS currentTaskId,
         t.title AS currentTaskTitle,
         t.stage AS currentTaskStage,
         t.status AS currentTaskStatus,
         COALESCE(tok.totalTokens, 0) AS todayTokens
       FROM agent a
       JOIN machine m ON m.id = a.machine_id
       LEFT JOIN agent_run r ON r.id = (
         SELECT id FROM agent_run
          WHERE agent_id = a.id AND status = 'running' AND last_seen_at >= @idleSince
          ORDER BY last_seen_at DESC, id DESC
          LIMIT 1
       )
       LEFT JOIN task t ON t.id = r.task_id
       LEFT JOIN (
         SELECT agent_id, MAX(last_seen_at) AS lastRunAt
           FROM agent_run GROUP BY agent_id
       ) lr ON lr.agent_id = a.id
       LEFT JOIN (
         SELECT agent_id,
                SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens)
                  AS totalTokens
           FROM token_usage
          WHERE occurred_at >= @since
          GROUP BY agent_id
       ) tok ON tok.agent_id = a.id
       WHERE a.status = 'active'
       ORDER BY (r.id IS NULL), r.last_seen_at DESC, a.id`,
    )
    .all(window) as AgentOverviewRow[];
}
