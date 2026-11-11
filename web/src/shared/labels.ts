import type {
  A2AIntent as A2aIntent,
  A2aThreadStatus,
  CapabilityStatus,
  OutboxStatus as DeliveryStatus,
  KnowledgeEmbeddingStatus,
  KnowledgeStatus,
  TaskEventKind,
  TaskOrigin,
  TaskStage,
  TaskStatus,
  WorkHoldReason,
  WorkItemAttention,
  WorkItemStage,
  WorkItemStatus,
} from "@shared/constants.js";
import type { ChainRelation } from "../api/task-chain.js";
import type { AgentRuntime, DispatchHoldReason, HeartbeatState } from "../api/types.js";

export type { Tone } from "./tone.js";
import type { Tone } from "./tone.js";

/** 机器无关(无 aw-node)的外部运行时:控制台不采集其 run/对话/Token,只显示分类标签 */
export const RUNTIME_LABEL: Record<AgentRuntime, string> = {
  claude_code: "Claude Code",
  workbuddy: "WorkBuddy",
  codex: "Codex",
  deepseek: "DeepSeek",
};

/** 控制台未采集该 Agent 的过程数据(机器无关运行时或尚未上报)时的统一占位文案 */
export const NOT_COLLECTED = "未接入 / —";

/** 「机器人」列的列头说明:名称来源与副行含义 */
export const AGENT_COLUMN_HINT =
  "「机器人」列是这个 Agent 在飞书群里的机器人名(由 Agent 自报,未回写时回退控制台显示名);下方副行是 cc-connect 项目名,「·」后面是路由 key(默认与项目名相同,相同时不重复显示)。";

/** 「机器」列的列头说明:机器的含义与外部运行时的差别 */
export const MACHINE_COLUMN_HINT =
  "该 Agent 运行在哪台执行机上;外部运行时可以登记归属机器,但没有 aw-node 时过程数据未接入。";

/** 「活跃会话」列的列头说明:会话数口径与派发闸门 G4 的机级上限一致 */
export const SESSION_COLUMN_HINT =
  "本机当前活跃的 Claude Code 会话数(仍在写的会话按运行计);同一台机上的 Agent 共享这个数字,与派发闸门的机级上限同口径。";

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
  work_item: "工作事项",
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

/** 工作事项:status 是生命周期,stage 是当前环节,attention 回答「是否需要人」 */
export const WORK_ITEM_STATUS_LABEL: Record<WorkItemStatus, string> = {
  open: "进行中",
  done: "已完成",
  cancelled: "已取消",
};

export const WORK_ITEM_STATUS_TONE: Record<WorkItemStatus, Tone> = {
  open: "info",
  done: "positive",
  cancelled: "muted",
};

export const WORK_ITEM_STAGE_LABEL: Record<WorkItemStage, string> = {
  intake: "接入",
  align: "对齐",
  execute: "执行",
  review: "评审",
  verify: "验证",
  release: "发布",
};

export const WORK_ITEM_ATTENTION_LABEL: Record<WorkItemAttention, string> = {
  none: "无需关注",
  person: "需要人",
  blocked: "阻塞",
  acceptance: "待验收",
  stalled: "异常停滞",
};

export const WORK_ITEM_ATTENTION_TONE: Record<WorkItemAttention, Tone> = {
  none: "muted",
  person: "danger",
  blocked: "warning",
  acceptance: "info",
  stalled: "warning",
};

/** 注意力严重度:数字越小越靠前,列表据此把要人处理的事顶上去 */
export const WORK_ITEM_ATTENTION_ORDER: Record<WorkItemAttention, number> = {
  person: 0,
  blocked: 1,
  acceptance: 2,
  stalled: 3,
  none: 4,
};

/** 工作事项事件类型:自由文本,查不到时回退原值 */
export const WORK_ITEM_EVENT_LABEL: Record<string, string> = {
  routed: "已路由",
  assigned: "已派工",
  input: "续接输入",
  accepted: "已接受",
  returned: "已退回",
  task_bound: "关联任务",
  handback: "退回交回",
  pr_linked: "关联 PR",
  pr_closed: "PR 已关闭",
  ci_result: "CI 结果",
  acceptance_ready: "待验收",
  ci_failed: "CI 失败",
  requeued: "已重排",
  stalled: "已停滞",
  orphaned: "承接方已删除",
};

/** 派发挂起原因:枚举与 collector 端 WORK_HOLD_REASONS 同源,文案口径对齐群播报 */
export const WORK_HOLD_REASON_LABEL: Record<WorkHoldReason, string> = {
  cwd_session_active: "工作区会话占用中",
  dirty_worktree: "工作区有未提交改动",
};

/** 派发挂起原因:aw-node 闸门/探测挡下派发时随心跳上报(M3.11),枚举与 collector 同源 */
export const DISPATCH_HOLD_LABEL: Record<DispatchHoldReason, string> = {
  cwd_unknown: "项目未配置",
  cwd_missing: "目录不存在",
  cwd_session_active: "会话占用",
  dirty_worktree: "工作区脏",
  machine_limit: "会话满",
  auth_stale: "密钥待重发",
  spawn_failed: "会话启动失败",
};

/** 会让派发完全出不去的原因(找不到目录/密钥失效/起不来)用 danger,闸门类保护性挂起用 warning */
export const DISPATCH_HOLD_TONE: Record<DispatchHoldReason, Tone> = {
  cwd_unknown: "danger",
  cwd_missing: "danger",
  cwd_session_active: "warning",
  dirty_worktree: "warning",
  machine_limit: "warning",
  auth_stale: "danger",
  spawn_failed: "danger",
};

/** 派工信箱状态:等待对象由 pending / claimed 的行推出 */
export const WORKER_INBOX_STATUS_LABEL: Record<string, string> = {
  pending: "待领取",
  claimed: "已领取",
  acked: "已确认",
  handed_back: "已交回",
  failed: "失败",
};

export const WORKER_INBOX_KIND_LABEL: Record<string, string> = {
  assignment: "派工",
  input: "续接输入",
};

/** 关联线程的订阅模式 */
export const THREAD_MODE_LABEL: Record<string, string> = {
  owner: "主责",
  context: "上下文",
};

