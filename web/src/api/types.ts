export interface OverviewMetrics {
  runningAgents: number;
  runningTasks: number;
  todayTokens: number;
  pendingApprovals: number;
  heartbeatTimeouts: number;
}

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
  /** 无任务归属时的会话实况:当前 run 最近一条用户指令(已截断) */
  currentInstruction: string | null;
  todayTokens: number;
}

export interface OverviewSnapshot {
  revision: number;
  generatedAt: number;
  todayStart: number;
  metrics: OverviewMetrics;
  agents: OverviewAgent[];
}
