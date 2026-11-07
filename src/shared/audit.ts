import type { ToolLevel, ToolVerdict } from "./constants.js";

/**
 * 工具调用审计负载:控制台 /mcp 在判定后直接落库(05 §6.4)。
 * agent_id 由调用方按 Bearer 身份注入,避免自述身份;远程 MCP 调用无 run 上下文,runId 为 null;
 * 无任务维度的只读调用(kb.search / a2a.inbox)taskId 亦为 null。
 */
export interface ToolCallAudit {
  runId: string | null;
  taskId: string | null;
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
