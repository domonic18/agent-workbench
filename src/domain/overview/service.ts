import { MACHINE_HEARTBEAT, RUN_IDLE_GAP_MS, type AgentRuntime, type DispatchHoldReason } from "../../shared/constants.js";
import { OVERVIEW_SCOPE } from "../../shared/scopes.js";
import { startOfLocalDay } from "../../shared/time.js";
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
  /** Agent 自报的飞书 bot 名称;为空表示尚未回写,显示时回退 displayName */
  feishuBotName: string | null;
  project: string;
  machineId: string | null;
  runtime: AgentRuntime;
  machineHostname: string | null;
  machineDisplayName: string | null;
  machineLastSeenAt: number | null;
  heartbeat: HeartbeatState;
  /** 本机活跃会话数(与派发闸门 G4 同口径的机级视图);机器无关运行时为 null */
  activeSessions: number | null;
  lastRunAt: number | null;
  running: boolean;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentTaskStage: string | null;
  currentTaskStatus: string | null;
  /** 无任务归属时的会话实况:当前 run 最近一条用户指令(已压平空白,截断 200 字符) */
  currentInstruction: string | null;
  /** 心跳上报的派发挂起(M3.12);机器无关运行时无派发概念,为 null */
  dispatchHold: DispatchHoldReason | null;
  dispatchPending: number | null;
  dispatchHoldSince: number | null;
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
  get(): Promise<OverviewSnapshot>;
}

export interface OverviewServiceDeps {
  db: Db;
  now?: () => number;
}

function instructionText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
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

  async function get(): Promise<OverviewSnapshot> {
    const at = now();
    const since = startOfLocalDay(at);
    // 四项指标与 Agent 列表必须共用同一时间窗口,否则同屏数字会互相打架
    const idleSince = at - RUN_IDLE_GAP_MS;
    const heartbeatSince = at - MACHINE_HEARTBEAT.timeoutMs;

    // 先取水位再读投影:期间发生的变更只会让 revision 更大,不会出现「新版本配旧数据」
    const revision = await currentRevision(db, OVERVIEW_SCOPE);
    const metrics = await getOverviewMetrics(db, { since, idleSince, heartbeatSince });
    const rows = await listAgentOverviewRows(db, { since, idleSince });

    return {
      revision,
      generatedAt: at,
      todayStart: since,
      metrics,
      agents: rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        feishuBotName: row.feishuBotName,
        project: row.project,
        machineId: row.machineId,
        runtime: row.runtime,
        machineHostname: row.machineHostname,
        machineDisplayName: row.machineDisplayName,
        machineLastSeenAt: row.machineLastSeenAt,
        heartbeat: heartbeatState(row.machineLastSeenAt, at),
        activeSessions: row.activeSessions,
        lastRunAt: row.lastRunAt,
        running: row.running === 1,
        currentTaskId: row.currentTaskId,
        currentTaskTitle: row.currentTaskTitle,
        currentTaskStage: row.currentTaskStage,
        currentTaskStatus: row.currentTaskStatus,
        currentInstruction: instructionText(row.currentInstruction),
        dispatchHold: row.dispatchHold,
        dispatchPending: row.dispatchPending,
        dispatchHoldSince: row.dispatchHoldSince,
        todayTokens: row.todayTokens,
      })),
    };
  }

  return { get };
}
