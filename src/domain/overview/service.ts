import { MACHINE_HEARTBEAT, RUN_IDLE_GAP_MS } from "../../shared/constants.js";
import { OVERVIEW_SCOPE } from "../../shared/scopes.js";
import type { Db } from "../../store/database.js";
import {
  getOverviewMetrics,
  listAgentOverviewRows,
  type OverviewMetrics,
} from "../../store/repositories/overview.js";
import { currentRevision } from "../../store/repositories/revision.js";

/** unknown = 从未上报心跳;ok/timeout/offline 按 04 §6 的两档阈值 */
export type HeartbeatState = "ok" | "timeout" | "offline" | "unknown";

export interface OverviewAgent {
  id: string;
  displayName: string;
  project: string;
  machineId: string;
  machineHostname: string;
  machineLastSeenAt: number | null;
  heartbeat: HeartbeatState;
  lastRunAt: number | null;
  running: boolean;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentTaskStage: string | null;
  currentTaskStatus: string | null;
  todayTokens: number;
}

export interface OverviewSnapshot {
  /** 总览作用域当前投影版本,SSE 断线重连时与帧内 revision 比对 */
  revision: number;
  generatedAt: number;
  /** 今日 token 统计起点(本地日零点) */
  todayStart: number;
  metrics: OverviewMetrics;
  agents: OverviewAgent[];
}

export interface OverviewService {
  get(): OverviewSnapshot;
}

export interface OverviewServiceDeps {
  db: Db;
  now?: () => number;
}

/** 本地日零点:跨时区部署时按控制台所在时区切日,与 03 §4.1 的「今日」一致 */
export function startOfLocalDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function heartbeatState(lastSeenAt: number | null, at: number): HeartbeatState {
  if (lastSeenAt === null) {
    return "unknown";
  }
  const idle = at - lastSeenAt;
  if (idle >= MACHINE_HEARTBEAT.offlineMs) {
    return "offline";
  }
  if (idle >= MACHINE_HEARTBEAT.timeoutMs) {
    return "timeout";
  }
  return "ok";
}

export function createOverviewService(deps: OverviewServiceDeps): OverviewService {
  const { db } = deps;
  const now = deps.now ?? Date.now;

  function get(): OverviewSnapshot {
    const at = now();
    const since = startOfLocalDay(at);
    // 四项指标与 Agent 列表必须共用同一时间窗口,否则同屏数字会互相打架
    const idleSince = at - RUN_IDLE_GAP_MS;
    const heartbeatSince = at - MACHINE_HEARTBEAT.timeoutMs;

    const metrics = getOverviewMetrics(db, { since, idleSince, heartbeatSince });
    const rows = listAgentOverviewRows(db, { since, idleSince });

    return {
      revision: currentRevision(db, OVERVIEW_SCOPE),
      generatedAt: at,
      todayStart: since,
      metrics,
      agents: rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        project: row.project,
        machineId: row.machineId,
        machineHostname: row.machineHostname,
        machineLastSeenAt: row.machineLastSeenAt,
        heartbeat: heartbeatState(row.machineLastSeenAt, at),
        lastRunAt: row.lastRunAt,
        running: row.running === 1,
        currentTaskId: row.currentTaskId,
        currentTaskTitle: row.currentTaskTitle,
        currentTaskStage: row.currentTaskStage,
        currentTaskStatus: row.currentTaskStatus,
        todayTokens: row.todayTokens,
      })),
    };
  }

  return { get };
}
