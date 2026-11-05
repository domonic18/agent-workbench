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
}

/** POST /api/aw-node/discovery 请求体 */
export interface DiscoveryReport {
  projects: DiscoveryProjectReport[];
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
