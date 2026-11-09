import type { AgentRuntime } from "../../shared/constants.js";
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
export async function getOverviewMetrics(db: Db, window: OverviewWindow): Promise<OverviewMetrics> {
  return (await db.get(
    `SELECT
       (SELECT COUNT(DISTINCT r.agent_id)
          FROM agent_run r JOIN agent a ON a.id = r.agent_id
         WHERE r.status = 'running' AND r.last_seen_at >= ?
           AND a.status = 'active') AS "runningAgents",
       (SELECT COUNT(*) FROM task WHERE status = 'running') AS "runningTasks",
       (SELECT COALESCE(SUM(
                 input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0)
          FROM token_usage WHERE occurred_at >= ?) AS "todayTokens",
       (SELECT COUNT(*) FROM capability WHERE status = 'pending') AS "pendingApprovals",
       (SELECT COUNT(*) FROM machine
         WHERE status = 'active' AND last_seen_at IS NOT NULL
           AND last_seen_at < ?) AS "heartbeatTimeouts"`,
    window.idleSince, window.since, window.heartbeatSince,
  )) as OverviewMetrics;
}

export interface AgentOverviewRow {
  id: string;
  displayName: string;
  /** Agent 自报的飞书 bot 名称;控制台优先用它显示,空则回退 displayName */
  feishuBotName: string | null;
  project: string;
  machineId: string | null;
  runtime: AgentRuntime;
  machineHostname: string | null;
  machineDisplayName: string | null;
  machineLastSeenAt: number | null;
  /** 本机活跃会话数(ingest 按机器聚合);无宿主机器为 null */
  activeSessions: number | null;
  lastRunAt: number | null;
  running: number;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentTaskStage: string | null;
  currentTaskStatus: string | null;
  /** 当前 run 最近一条用户指令的开头;没有任务归属时用来回答「在忙什么」 */
  currentInstruction: string | null;
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
export async function listAgentOverviewRows(
  db: Db,
  window: AgentOverviewWindow,
): Promise<AgentOverviewRow[]> {
  return (await db.all(
    `SELECT
       a.id,
       a.display_name AS "displayName",
       a.feishu_bot_name AS "feishuBotName",
       a.project,
       a.machine_id AS "machineId",
       a.runtime AS "runtime",
       m.hostname AS "machineHostname",
       m.display_name AS "machineDisplayName",
       m.last_seen_at AS "machineLastSeenAt",
       CASE WHEN a.machine_id IS NULL THEN NULL ELSE (
         SELECT COUNT(*) FROM agent_run r2
          WHERE r2.machine = a.machine_id AND r2.status = 'running' AND r2.last_seen_at >= ?
       ) END AS "activeSessions",
       lr."lastRunAt",
       CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS running,
       r.task_id AS "currentTaskId",
       t.title AS "currentTaskTitle",
       t.stage AS "currentTaskStage",
       t.status AS "currentTaskStatus",
       (SELECT substr(e.payload_json::jsonb->>'text', 1, 200)
          FROM timeline_event e
         WHERE e.run_id = r.id AND e.kind = 'user_message'
           -- 运行时注入的 <task-notification> 之类也记为 user_message,不代表人的指令
           AND ltrim(e.payload_json::jsonb->>'text') NOT LIKE '<%'
         ORDER BY e.occurred_at DESC, e.ord DESC LIMIT 1) AS "currentInstruction",
       COALESCE(tok."totalTokens", 0) AS "todayTokens"
     FROM agent a
     LEFT JOIN machine m ON m.id = a.machine_id
     LEFT JOIN agent_run r ON r.id = (
       SELECT id FROM agent_run
        WHERE agent_id = a.id AND status = 'running' AND last_seen_at >= ?
        ORDER BY last_seen_at DESC, id DESC
        LIMIT 1
     )
     LEFT JOIN task t ON t.id = r.task_id
     LEFT JOIN (
       SELECT agent_id, MAX(last_seen_at) AS "lastRunAt"
         FROM agent_run GROUP BY agent_id
     ) lr ON lr.agent_id = a.id
     LEFT JOIN (
       SELECT agent_id,
              SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens)
                AS "totalTokens"
         FROM token_usage
        WHERE occurred_at >= ?
        GROUP BY agent_id
     ) tok ON tok.agent_id = a.id
     WHERE a.status = 'active'
     ORDER BY (r.id IS NULL), r.last_seen_at DESC, a.id`,
    window.idleSince, window.idleSince, window.since,
  )) as AgentOverviewRow[];
}
