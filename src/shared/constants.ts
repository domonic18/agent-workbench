// 枚举唯一来源:SQL 的 CHECK 约束、领域状态机、信封校验都从这里取,禁止各层各写一份

export const TASK_STATUSES = [
  "pending",
  "running",
  "blocked",
  "review",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STAGES = [
  "intake",
  "plan",
  "exec",
  "review",
  "deliver",
  "closed",
] as const;
export type TaskStage = (typeof TASK_STAGES)[number];

export const TASK_ORIGINS = ["feishu", "a2a"] as const;
export type TaskOrigin = (typeof TASK_ORIGINS)[number];

export const TASK_EVENT_KINDS = [
  "created",
  "stage_changed",
  "handoff",
  "blocked",
  "resumed",
  "rework",
  "completed",
  "failed",
] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

export const A2A_INTENTS = ["request", "reply", "notify", "escalate"] as const;
export type A2AIntent = (typeof A2A_INTENTS)[number];

/** 飞书指令审计结果;与 feishu_command.outcome 的 CHECK 一致 */
export const COMMAND_OUTCOMES = ["handled", "unsupported", "invalid"] as const;
export type CommandOutcome = (typeof COMMAND_OUTCOMES)[number];

/** 授权状态机(05 §2):单向,issuing 是「已批准、正在签发」的中间态 */
export const CAPABILITY_STATUSES = [
  "pending",
  "issuing",
  "active",
  "expired",
  "revoked",
  "rejected",
] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/** 能力动作只收枚举,不接受自由文本 */
export const CAPABILITY_ACTIONS = ["read", "write", "exec"] as const;
export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number];

export const CAPABILITY_AUDIT_ACTIONS = [
  "requested",
  "approved",
  "rejected",
  "issued",
  "issue_failed",
  "expired",
  "revoked",
  "reconciled",
] as const;
export type CapabilityAuditAction = (typeof CAPABILITY_AUDIT_ACTIONS)[number];

/** TTL 默认 15 分钟,上限 4 小时(05 §2) */
export const CAPABILITY_TTL = {
  defaultSeconds: 900,
  maxSeconds: 14400,
} as const;

/** 工具调用分级与判定(05 §6.1);未知动作按 L2 处理 */
export const TOOL_LEVELS = ["L0", "L1", "L2"] as const;
export type ToolLevel = (typeof TOOL_LEVELS)[number];

export const TOOL_VERDICTS = ["allow", "deny", "require_approval"] as const;
export type ToolVerdict = (typeof TOOL_VERDICTS)[number];

export const A2A_PROTOCOL_VERSION = "1.0";

/** summary / expect 长度上限:信封是索引而非正文,长内容走 refs 指向的知识条目 */
export const ENVELOPE_LIMITS = {
  summary: 200,
  expect: 200,
  identifier: 128,
  refs: 20,
} as const;
