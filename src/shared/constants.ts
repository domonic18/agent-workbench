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

/** 补偿窗口(05 §5 / 01 §9):待批 24h 转驳回,issuing 超 60s 由对账收敛 */
export const CAPABILITY_TIMEOUTS = {
  pendingMs: 24 * 60 * 60 * 1000,
  issuingMs: 60_000,
} as const;

/** 控制台会话寿命(01 §3 注:刻意收紧为 12 小时,不采纳需求的 7 天滑动) */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** 飞书事件/卡片回调时间窗(01 §8):超过 24 小时或超前 5 分钟一律丢弃 */
export const FEISHU_EVENT_WINDOW = {
  maxAgeMs: 24 * 60 * 60 * 1000,
  maxFutureSkewMs: 5 * 60 * 1000,
} as const;

/** 发件箱状态机(01 §6);sending / uncertain 由异步通道使用,push 同步发送不产生 */
export const OUTBOX_STATUSES = [
  "pending",
  "claimed",
  "sending",
  "retry_wait",
  "delivered",
  "failed",
  "uncertain",
] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** push = 飞书等推模式;pull = A2A 信箱,以 ACK 为投递判据 */
export const OUTBOX_CHANNELS = ["push", "pull"] as const;
export type OutboxChannel = (typeof OUTBOX_CHANNELS)[number];

/** business = 失败围栏任务;notification = 只重试,不围栏 */
export const OUTBOX_DELIVERY_CLASSES = ["business", "notification"] as const;
export type OutboxDeliveryClass = (typeof OUTBOX_DELIVERY_CLASSES)[number];

/** 领取租约与通知类重试策略:拉长窗口覆盖同步 HTTP,失败指数退避到上限即判死 */
export const OUTBOX_TIMEOUTS = {
  leaseMs: 30_000,
  maxAttempts: 8,
  retryBaseMs: 5_000,
  retryMaxMs: 5 * 60 * 1000,
  pollMs: 2_000,
} as const;

/** 工具调用分级与判定(05 §6.1);未知动作按 L2 处理 */
export const TOOL_LEVELS = ["L0", "L1", "L2"] as const;
export type ToolLevel = (typeof TOOL_LEVELS)[number];

export const TOOL_VERDICTS = ["allow", "deny", "require_approval"] as const;
export type ToolVerdict = (typeof TOOL_VERDICTS)[number];

/**
 * 分级白名单(05 §6.1):L0/L1 只收明确登记的点分名,清单外一律按 L2 审批。
 * L2 审批挂起 300s,超时按拒绝处理。
 */
export const TOOL_GATE = {
  approvalTimeoutMs: 5 * 60 * 1000,
  l0: ["fs.read", "db.query", "kb.search", "a2a.inbox"],
  l1: ["task.create", "task.update", "a2a.send", "a2a.ack", "kb.write"],
} as const;

export const A2A_PROTOCOL_VERSION = "1.0";

/** summary / expect 长度上限:信封是索引而非正文,长内容走 refs 指向的知识条目 */
export const ENVELOPE_LIMITS = {
  summary: 200,
  expect: 200,
  identifier: 128,
  refs: 20,
} as const;
