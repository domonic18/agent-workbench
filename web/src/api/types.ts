export interface OverviewMetrics {
  runningAgents: number;
  runningTasks: number;
  todayTokens: number;
  pendingApprovals: number;
  heartbeatTimeouts: number;
}

import { AGENT_RUNTIMES, DISPATCH_HOLD_REASONS } from "@shared/constants.js";

export type HeartbeatState = "ok" | "timeout" | "offline" | "unknown";

/** Agent 运行时:与控制台 shared/constants AGENT_RUNTIMES 一一对应;web 侧无 aw-node 绑定概念,只用于展示标签 */
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];

/** 派发挂起原因:与控制台/collector 共用的 DISPATCH_HOLD_REASONS 同源 */
export type DispatchHoldReason = (typeof DISPATCH_HOLD_REASONS)[number];

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
  /** 本机活跃会话数(ingest 按机器聚合,与派发闸门 G4 同口径);机器无关运行时为 null */
  activeSessions: number | null;
  lastRunAt: number | null;
  running: boolean;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentTaskStage: string | null;
  currentTaskStatus: string | null;
  /** 无任务归属时的会话实况:当前 run 最近一条用户指令(已截断) */
  currentInstruction: string | null;
  /** 心跳上报的派发挂起(M3.11);机器无关运行时无派发概念,为 null */
  dispatchHold: DispatchHoldReason | null;
  dispatchPending: number | null;
  dispatchHoldSince: number | null;
  todayTokens: number;
}

export interface OverviewSnapshot {
  revision: number;
  generatedAt: number;
  todayStart: number;
  metrics: OverviewMetrics;
  agents: OverviewAgent[];
}
