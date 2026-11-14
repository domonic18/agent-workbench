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
  /** 最近一次已结束运行的结束时刻;从未跑完过为 null */
  lastRunEndedAt: number | null;
  running: boolean;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentTaskStage: string | null;
  currentTaskStatus: string | null;
  /** 无任务归属时的会话实况:当前 run 最近一条用户指令(已截断) */
  currentInstruction: string | null;
  /** 心跳上报的派发挂起(M3.12);机器无关运行时无派发概念,为 null */
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

/**
 * 定时任务只读观测的一行
 *
 * 与服务端 `src/domain/schedule/types.ts` 的 ScheduleRow 一一对应(两侧各维护一份,
 * 改字段必须同改)。
 */
export interface ScheduleRow {
  /** 计划唯一标识,形如 `cron:<job id>` */
  id: string;
  /** cc-connect 项目名 */
  project: string;
  /** cron=周期任务;timer=一次性延时任务 */
  kind: "cron" | "timer";
  /** 任务标题 */
  description: string;
  /** 周期任务的 cron 表达式;一次性任务为 null */
  cronExpr: string | null;
  /** 一次性任务的执行时刻(epoch ms) */
  scheduledAt: number | null;
  /** 下次执行时刻(epoch ms) */
  nextRunAt: number | null;
  /** 上次执行时刻(epoch ms) */
  lastRunAt: number | null;
  /** 上次执行的错误摘要(已脱敏) */
  lastError: string | null;
  enabled: boolean;
  /** 计划所在机器的 IANA 时区 */
  timezone: string;
  machineId: string;
  machineName: string;
  /** 关联到的 Agent;项目未登记时为 null */
  agentId: string | null;
  agentName: string | null;
  /** 飞书 bot 名(优先展示) */
  botName: string | null;
  /** 机器离线或久未上报:计划状态未知 */
  stale: boolean;
  /** 最后采集时刻(epoch ms) */
  collectedAt: number | null;
}
