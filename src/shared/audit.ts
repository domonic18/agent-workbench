import type { ToolLevel, ToolVerdict } from "./constants.js";

/**
 * 工具调用审计负载:proxy 判定后经 HTTP 交给控制台落库(05 §6.4)。
 * agent_id 不在负载里,由控制台按 Bearer 身份注入,避免自述身份。
 */
export interface ToolCallAudit {
  runId: string;
  taskId: string;
  /** 闸门点分名,如 `task.create` */
  tool: string;
  /** 参数哈希(不落原文) */
  argsHash: string;
  level: ToolLevel;
  verdict: ToolVerdict;
  reason: string | null;
  capabilityId: string | null;
  durationMs: number | null;
  occurredAt: number;
}
