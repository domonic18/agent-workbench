export interface OverviewMetrics {
  runningAgents: number;
  runningTasks: number;
  todayTokens: number;
  pendingApprovals: number;
  heartbeatTimeouts: number;
}

import { AGENT_RUNTIMES } from "@shared/constants.js";

export type HeartbeatState = "ok" | "timeout" | "offline" | "unknown";

/** Agent 运行时:与控制台 shared/constants AGENT_RUNTIMES 一一对应;web 侧无 aw-node 绑定概念,只用于展示标签 */
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];

export interface OverviewAgent {
  id: string;
  displayName: string;
  project: string;
  machineId: string | null;
  runtime: AgentRuntime;
  machineHostname: string | null;
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
