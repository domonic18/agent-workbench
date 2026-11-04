import type {
  KnowledgeEmbeddingStatus,
  KnowledgeStatus,
} from "../api/knowledge.js";
import type { ChainRelation } from "../api/task-chain.js";
import type {
  A2aIntent,
  A2aThreadStatus,
  CapabilityStatus,
  DeliveryStatus,
  TaskEventKind,
  TaskOrigin,
  TaskStage,
  TaskStatus,
} from "../api/tasks.js";
import type { AgentRuntime, HeartbeatState } from "../api/types.js";

export type Tone = "positive" | "warning" | "danger" | "muted" | "info";

/** 机器无关(无 aw-node)的外部运行时:控制台不采集其 run/对话/Token,只显示分类标签 */
export const RUNTIME_LABEL: Record<AgentRuntime, string> = {
  claude_code: "Claude Code",
  workbuddy: "WorkBuddy",
  codex: "Codex",
  deepseek: "DeepSeek",
};

/** 控制台未采集该 Agent 的过程数据(机器无关运行时或尚未上报)时的统一占位文案 */
export const NOT_COLLECTED = "未接入 / —";

/** 状态到文案/色调的映射只在这里维护,组件不自行判断业务枚举(03 §6) */
export const HEARTBEAT_LABEL: Record<HeartbeatState, string> = {
  ok: "在线",
  timeout: "心跳超时",
  offline: "离线",
  unknown: "未上报",
};

export const HEARTBEAT_TONE: Record<HeartbeatState, Tone> = {
  ok: "positive",
  timeout: "warning",
  offline: "danger",
  unknown: "muted",
};

export type RealtimeStatus = "connecting" | "live" | "disconnected";

export const REALTIME_LABEL: Record<RealtimeStatus, string> = {
  connecting: "连接中",
  live: "实时连接",
  disconnected: "实时断开",
};

export const REALTIME_TONE: Record<RealtimeStatus, Tone> = {
  connecting: "muted",
  live: "positive",
  disconnected: "warning",
};

export const VISIBILITY_NOTE =
  "控制台只看到自报的与自己的会话，看不到不属于它的飞书对话。";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "待开始",
  running: "进行中",
  blocked: "阻塞",
  review: "待审阅",
  done: "已完成",
  cancelled: "已取消",
};

export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  pending: "muted",
  running: "info",
  blocked: "warning",
  review: "info",
  done: "positive",
  cancelled: "muted",
};

export const TASK_STAGE_LABEL: Record<TaskStage, string> = {
  intake: "接入",
  plan: "规划",
  exec: "执行",
  review: "审阅",
  deliver: "交付",
  closed: "关闭",
};

export const TASK_ORIGIN_LABEL: Record<TaskOrigin, string> = {
  feishu: "飞书",
  a2a: "A2A",
};

export const TASK_EVENT_LABEL: Record<TaskEventKind, string> = {
  created: "创建任务",
  stage_changed: "阶段变更",
  handoff: "交接",
  blocked: "转为阻塞",
  resumed: "恢复运行",
  rework: "返工",
  completed: "完成",
  failed: "失败",
};

export const A2A_INTENT_LABEL: Record<A2aIntent, string> = {
  request: "请求",
  reply: "回复",
  notify: "通知",
  escalate: "升级",
};

export const A2A_THREAD_STATUS_LABEL: Record<A2aThreadStatus, string> = {
  open: "进行中",
  awaiting_reply: "等待回复",
  completed: "已完结",
  expired: "已过期",
};

export const A2A_THREAD_STATUS_TONE: Record<A2aThreadStatus, Tone> = {
  open: "info",
  awaiting_reply: "warning",
  completed: "positive",
  expired: "danger",
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: "待投递",
  claimed: "已领取",
  sending: "投递中",
  retry_wait: "等待重试",
  delivered: "已投递",
  failed: "投递失败",
  uncertain: "投递不确定",
};

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, Tone> = {
  pending: "muted",
  claimed: "info",
  sending: "info",
  retry_wait: "warning",
  delivered: "positive",
  failed: "danger",
  uncertain: "warning",
};

export const CAPABILITY_STATUS_LABEL: Record<CapabilityStatus, string> = {
  pending: "待批",
  issuing: "签发中",
  active: "生效",
  expired: "已过期",
  revoked: "已吊销",
  rejected: "已驳回",
};

export const CAPABILITY_STATUS_TONE: Record<CapabilityStatus, Tone> = {
  pending: "warning",
  issuing: "info",
  active: "positive",
  expired: "muted",
  revoked: "muted",
  rejected: "danger",
};

export const CHAIN_RELATION_LABEL: Record<ChainRelation, string> = {
  a2a: "A2A 交接",
  continuation: "本方续接",
  unknown: "上游关联",
};

export const KNOWLEDGE_STATUS_LABEL: Record<KnowledgeStatus, string> = {
  draft: "草稿",
  candidate: "待采纳",
  active: "已生效",
  archived: "已归档",
};

export const KNOWLEDGE_STATUS_TONE: Record<KnowledgeStatus, Tone> = {
  draft: "muted",
  candidate: "warning",
  active: "positive",
  archived: "muted",
};

export const KNOWLEDGE_EMBEDDING_LABEL: Record<KnowledgeEmbeddingStatus, string> = {
  pending: "待索引",
  ready: "已索引",
  failed: "索引失败",
};

export const KNOWLEDGE_EMBEDDING_TONE: Record<KnowledgeEmbeddingStatus, Tone> = {
  pending: "warning",
  ready: "positive",
  failed: "danger",
};
