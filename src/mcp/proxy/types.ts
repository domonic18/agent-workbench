import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ApprovalRequester } from "../../domain/capability/approval.js";
import type { RunContext } from "../../domain/capability/gate.js";
import type { NewToolCallLog } from "../../store/repositories/tool-call-log.js";

export const PROXY_VERSION = "0.1.0";

export interface Upstream {
  id: string;
  /** S1 结论:启动时缓存 tools/list,上游动态变更不生效 */
  tools(): readonly Tool[];
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

/** 审计写失败即拒绝执行,因此这里允许抛错 */
export type AuditSink = (entry: NewToolCallLog) => void;

export interface ProxyLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export interface GatewayOptions {
  ctx: RunContext;
  upstreams: readonly Upstream[];
  audit: AuditSink;
  approval?: ApprovalRequester;
  approvalTimeoutMs?: number;
  /** upstreamId → 上游工具名 → 闸门点分名 */
  toolMap?: Record<string, Record<string, string>>;
  now?: () => number;
  log?: ProxyLogger;
}
