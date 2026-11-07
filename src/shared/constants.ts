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

export const TASK_ORIGINS = ["feishu", "a2a", "work_item"] as const;
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

/** 建单 / 改单字段长度上限(01 §5.2);project 闭集校验留 M3 */
export const TASK_LIMITS = {
  title: 200,
  assigner: 128,
  project: 128,
  output: 2048,
  reason: 512,
} as const;

export const A2A_INTENTS = ["request", "reply", "notify", "escalate"] as const;
export type A2AIntent = (typeof A2A_INTENTS)[number];

/** 工作事项(arch/02 §3.9):Mandate 快照创建时定型;status 是生命周期,stage 是当前环节 */
export const WORK_ITEM_STATUSES = ["open", "done", "cancelled"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_STAGES = [
  "intake",
  "align",
  "execute",
  "review",
  "verify",
  "release",
] as const;
export type WorkItemStage = (typeof WORK_ITEM_STAGES)[number];

/** attention 回答「当前是否需要人、为何需要」,不复制 Task/Run 状态 */
export const WORK_ITEM_ATTENTIONS = ["none", "person", "blocked", "acceptance", "stalled"] as const;
export type WorkItemAttention = (typeof WORK_ITEM_ATTENTIONS)[number];

/** 触发事实的唯一确定性处置;同一事件重放返回首次处置,不改写 */
export const WORK_TRIGGER_DISPOSITIONS = [
  "received",
  "continued",
  "routed",
  "needs_person",
  "ignored",
] as const;
export type WorkTriggerDisposition = (typeof WORK_TRIGGER_DISPOSITIONS)[number];

/** 控制面到 Worker 的派工与续接输入;与 A2A 信封、WorkItem 完成状态互不复用 */
export const WORKER_INBOX_KINDS = ["assignment", "input"] as const;
export type WorkerInboxKind = (typeof WORKER_INBOX_KINDS)[number];

export const WORKER_INBOX_STATUSES = [
  "pending",
  "claimed",
  "acked",
  "handed_back",
  "failed",
] as const;
export type WorkerInboxStatus = (typeof WORKER_INBOX_STATUSES)[number];

/** 线程状态不落库(02 §3.3),读取时按消息与投递记录现算 */
export const A2A_THREAD_STATUSES = ["open", "awaiting_reply", "completed", "expired"] as const;
export type A2aThreadStatus = (typeof A2A_THREAD_STATUSES)[number];

/** 飞书指令审计结果;与 feishu_command.outcome 的 CHECK 一致 */
export const COMMAND_OUTCOMES = ["handled", "unsupported", "invalid"] as const;
export type CommandOutcome = (typeof COMMAND_OUTCOMES)[number];

/** 机器与 Agent 吊销状态(01 §4):disabled 后下一次请求即 401,行保留不删 */
export const IDENTITY_STATUSES = ["active", "disabled"] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

/**
 * Agent 运行时(01 §6):claude_code=aw-node 采集器绑定的本机运行时;
 * 其余为无 aw-node 的外部运行时(WorkBuddy/Codex/DeepSeek harness),直接拿 Agent Bearer 打 /mcp,
 * 控制台不采集其 run/对话/Token。新增运行时 = 追一句 CHECK 值 + 本元组,行为逻辑只看 machine_id 是否 NULL。
 */
export const AGENT_RUNTIMES = ["claude_code", "workbuddy", "codex", "deepseek"] as const;
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];

/** 无 aw-node 的外部运行时集合;与 claude_code 互斥,注册机器无关 Agent 时必须给出 */
export const EXTERNAL_RUNTIMES = AGENT_RUNTIMES.filter(
  (runtime) => runtime !== "claude_code",
) as readonly Exclude<AgentRuntime, "claude_code">[];

/** 注册字段长度上限;id 由调用方给(machine)或服务端生成(agent) */
export const IDENTITY_LIMITS = {
  id: 128,
  project: 128,
  displayName: 128,
  hostname: 256,
  os: 64,
  collectorVersion: 64,
  allowedTargets: 64,
} as const;

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

/**
 * 知识条目状态(02 §3.5):candidate 只能由 kb_write 写入且服务端强制,
 * 必须经人在知识屏采纳才转 active,避免 Agent 自己教自己。
 */
export const KNOWLEDGE_STATUSES = ["draft", "candidate", "active", "archived"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

/** 向量索引状态(02 §3.5):pending 待嵌入 / ready 可检索 / failed 需重试 */
export const KNOWLEDGE_EMBEDDING_STATUSES = ["pending", "ready", "failed"] as const;
export type KnowledgeEmbeddingStatus = (typeof KNOWLEDGE_EMBEDDING_STATUSES)[number];

/** 受保护文件(02 §3.5):控制台、Agent 写入工具、批量操作三条路径都拒绝改写 */
export const KNOWLEDGE_PROTECTED_FILES = ["index.md", "log.md"] as const;

/** 知识编辑字段上限;正文上限防止单次请求撑爆内存与文件系统 */
export const KNOWLEDGE_LIMITS = {
  title: 200,
  summary: 512,
  category: 64,
  content: 500_000,
  search: 200,
} as const;

/** 索引链(02 §3.5 / M3.5-4):维度固定 768,FTS 用 trigram 覆盖中文子串 */
export const KNOWLEDGE_INDEX = {
  dimensions: 768,
  chunkMaxChars: 800,
  embedBatchSize: 16,
} as const;

/** 控制台会话寿命(01 §3 注:刻意收紧为 12 小时,不采纳需求的 7 天滑动) */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** 登录失败锁定(01 §3):连续 5 次锁 10 分钟,成功即清零;作用于登录与改口令的口令校验 */
export const LOGIN_LOCKOUT = {
  maxFailures: 5,
  lockMs: 10 * 60 * 1000,
} as const;

/** 管理员口令最小长度:后端校验与前端表单共用同一处,避免两侧各写一个数字 */
export const CONSOLE_PASSWORD_MIN_LENGTH = 6;

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

/** 审计对账缺口(05 §7):缺会话 / 任务对不上 / Teleport 侧多出的会话 */
export const AUDIT_GAP_KINDS = ["missing_session", "ticket_mismatch", "orphan_session"] as const;
export type AuditGapKind = (typeof AUDIT_GAP_KINDS)[number];

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

export const TOOL_VERDICTS = ["allow", "deny"] as const;
export type ToolVerdict = (typeof TOOL_VERDICTS)[number];

/** 远程 MCP 接入参数(01 §5.2):端点路径、鉴权头名与凭据格式;服务端、手册与前端共用一处 */
export const MCP_ACCESS = {
  path: "/mcp",
  authHeader: "authorization",
  bearerFormat: "Bearer {agentId}.{secret}",
} as const;

/** 按协议格式拼出完整的凭据头值;格式只在 MCP_ACCESS 里定义一次 */
export function formatBearer(agentId: string, secret: string): string {
  return MCP_ACCESS.bearerFormat.replace("{agentId}", agentId).replace("{secret}", secret);
}

/**
 * Agent 自助接入面(01 §5.2):不依赖 MCP 的 REST 通道,Bearer 直调。
 * 只配了 Bearer 就能拿规范、查可委派目标、发消息与回执——MCP 是可选增强。
 */
export const AGENT_REST = {
  guide: "/api/agent-kit/guide",
  skill: "/api/agent-kit/skill",
  peers: "/api/agent/peers",
  enroll: "/api/agent-enroll",
  a2aMessages: "/api/a2a/messages",
  a2aInbox: "/api/a2a/inbox",
} as const;

/**
 * 分级白名单(05 §6.1):L0/L1 只收明确登记的点分名,清单外一律按 L2 默认拒绝。
 * 控制工具是封闭集合;资源类常驻授权走能力申请(飞书卡片),不经本清单。
 */
export const TOOL_GATE = {
  l0: ["kb.search", "a2a.inbox", "guide.read"],
  l1: [
    "task.create",
    "task.update",
    "a2a.send",
    "a2a.ack",
    "kb.write",
    "work.read",
    "work.inbox",
    "work.ack",
    "work.handback",
    "work.report",
    "work.decide",
  ],
} as const;

/** worker_inbox 租约与轮询(01 §10):租约覆盖 read→task_create→ack 链路,过期只改状态不建行 */
export const WORK_INBOX = {
  leaseMs: 10 * 60_000,
  maxWaitMs: 30_000,
  /** 服务端租约回收巡检间隔 */
  pollMs: 2_000,
  /** Agent 长轮询无行时的内部探测间隔 */
  probeMs: 1_000,
} as const;

/** 列表接口的统一分页边界:默认 50 条,单页最多 200 条 */
export const LIST_LIMITS = {
  default: 50,
  max: 200,
} as const;

export const A2A_PROTOCOL_VERSION = "1.0";

/** 信箱长轮询(01 §5.1):默认挂起 25s、上限 30s;单页最多 20 条 */
export const A2A_INBOX = {
  waitMs: 25_000,
  maxWaitMs: 30_000,
  pageSize: 20,
} as const;

/** 死信巡检(01 §9):每 60s 扫一次,单轮最多处理 100 条 */
export const A2A_DEAD_LETTER = {
  sweepIntervalMs: 60_000,
  batchSize: 100,
} as const;

/** run 末态(02 §3.2):running 是当前 run,ended 是已收尾的历史 run */
export const RUN_STATUSES = ["running", "ended"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** run 切分硬阈值:同一流相邻事件间隔 ≥30 分钟即开新 run,不做自适应(02 §3.2) */
export const RUN_IDLE_GAP_MS = 30 * 60 * 1000;

/** SSE(01 §7):20s 心跳防中间层断连,1s 轮询作用域水位,单用户最多 10 个客户端 */
export const SSE = {
  heartbeatMs: 20_000,
  pollMs: 1000,
  maxClients: 10,
} as const;

/** 心跳(04 §6):超过 5 分钟标「心跳超时」,超过 30 分钟标「离线」 */
export const MACHINE_HEARTBEAT = {
  timeoutMs: 5 * 60 * 1000,
  offlineMs: 30 * 60 * 1000,
} as const;

/** 内部记账伪模型:不是真实网关调用,不入 token_usage(02 §3.6) */
export const SYNTHETIC_MODEL = "<synthetic>";

/** 一次性令牌(01 §2 / 04 §密钥):bootstrap_admin 供 /setup 首次设置管理员,enroll 供安装脚本兑换机器密钥,agent_enroll 供 Agent 自助兑换接入密钥 */
export const ONE_TIME_TOKEN = {
  prefix: "ott_",
  adminTtlMs: 60 * 60 * 1000,
  /** enroll 与 agent_enroll 共用同一档 TTL:够走完一次接入,也不至于长期有效 */
  enrollTtlMs: 15 * 60 * 1000,
} as const;

/** 采集入库(01 §3.1 / 04 §4):批次上限、7 天去重窗口与清理周期 */
export const INGEST = {
  batchMax: 500,
  receiptRetentionMs: 7 * 24 * 60 * 60 * 1000,
  receiptSweepIntervalMs: 60 * 60 * 1000,
} as const;

/** token 用量事件类型:采集器按此 kind 上报四维用量(02 §3.6) */
export const INGEST_TOKEN_USAGE_KIND = "token_usage";

/** 坏项留痕事件类型:内容存不下被跳过的采集项,原 kind 与失败原因记在 payload */
export const INGEST_REJECTED_KIND = "ingest_rejected";

/** summary / expect 长度上限:信封是索引而非正文,长内容走 refs 指向的知识条目 */
export const ENVELOPE_LIMITS = {
  summary: 200,
  expect: 200,
  identifier: 128,
  refs: 20,
} as const;
