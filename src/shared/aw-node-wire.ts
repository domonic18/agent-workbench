/**
 * 控制台 ↔ aw-node 的线上协议类型（snake_case）。
 * 服务端路由/域与 collector 共用同一份,禁止两侧各维护一份。
 */
import type { A2AIntent } from "./constants.js";

/** POST /api/aw-node/enroll 请求体 */
export interface EnrollRequestBody {
  token: string;
  hostname: string;
  os: string;
  collector_version: string;
}

/** POST /api/aw-node/enroll 响应:明文密钥只在本次响应出现一次 */
export interface EnrollResponseBody {
  machine_id: string;
  collector_secret: string;
}

/** 发现上报的单个项目;agents/channels 为非敏感展示元数据 */
export interface DiscoveryProjectReport {
  name: string;
  cwd?: string | undefined;
  agents?: unknown[] | undefined;
  channels?: unknown[] | undefined;
  /** 飞书 bot 名与 open_id 由 aw-node 用本机应用凭据经 bot/v3/info 取得,非敏感展示字段 */
  feishu_bot_name?: string | undefined;
  feishu_bot_open_id?: string | undefined;
}

/**
 * 采集端上报的定时任务快照
 *
 * 只含展示必需字段:prompt / exec / work_dir / session_key 等敏感内容在采集端剔除,
 * 不出机器(控制台公网可达,prompt 实测含明文 ssh 命令与内网地址)。
 */
export interface ScheduleReport {
  id: string;
  /** cc-connect 项目名;与机器一起定位对应 Agent 机器人 */
  project: string;
  /** cron=周期任务;timer=一次性延时任务 */
  kind: "cron" | "timer";
  /** 任务标题(人工可读,非敏感);缺失时回退项目名 */
  description: string;
  /** 周期任务的 5 字段 cron 表达式;一次性任务为 null */
  cron_expr: string | null;
  /** 一次性任务的执行时刻(epoch ms);周期任务为 null */
  scheduled_at: number | null;
  enabled: boolean;
  /** 上次执行时刻(epoch ms) */
  last_run: number | null;
  /** 下次执行时刻(epoch ms,按计划所在机器的本地时区推算) */
  next_run: number | null;
  /** 上次执行的错误摘要(已脱敏) */
  last_error: string | null;
  created_at: number | null;
  /** 计划所在机器的 IANA 时区 */
  timezone: string;
}

/** POST /api/aw-node/discovery 请求体 */
export interface DiscoveryReport {
  projects: DiscoveryProjectReport[];
  /** 本机 cc-connect 的定时任务快照;整包覆盖,缺省即为空 */
  schedules?: ScheduleReport[] | undefined;
}

/** POST /api/aw-node/config 响应中的单个 Agent 配置 */
export interface DeliveredAgentConfig {
  agent_id: string;
  key: string;
  project: string;
  config_version: number;
  /** true=本次轮换并携带明文密钥(明文仅出现在本响应);false=已生效,不含明文 */
  rotated: boolean;
  secret?: string;
  mcp: { endpoint: string };
}

/** POST /api/aw-node/config 响应 */
export interface PullConfigResponse {
  config_status: string;
  agents: DeliveredAgentConfig[];
  /** 控制台请求刷新 bot 名:aw-node 收到后清空缓存并立即重取上报 */
  refresh_bot_names?: boolean;
}

/** POST /api/aw-node/config/ack 请求体 */
export interface ConfigAckRequest {
  agents: Array<{ agent_id: string; config_version: number }>;
}

/** POST /api/aw-node/config/ack 响应 */
export interface ConfigAckResponse {
  ok: boolean;
  config_status: string;
  acked: string[];
}

/** GET /api/a2a/inbox 响应中的单条消息 */
export interface A2aInboxItem {
  msg_id: string;
  thread_id: string;
  task_id: string;
  round: number;
  reply_to: string | null;
  from: string;
  to: string;
  intent: A2AIntent;
  summary: string;
  expect: string;
  deadline: string | null;
  refs: string[];
  auth: { ticket_id: string } | null;
  created_at: number;
}

/** GET /api/a2a/inbox 响应 */
export interface A2aInboxResult {
  items: A2aInboxItem[];
  nextCursor: string | null;
}
