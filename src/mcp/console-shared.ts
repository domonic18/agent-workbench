import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { A2aError } from "../domain/a2a/errors.js";
import type { A2aService } from "../domain/a2a/types.js";
import type { AnnounceOptions } from "../domain/collab/announce.js";
import { KnowledgeError } from "../domain/knowledge/entry-service.js";
import { TaskError } from "../domain/task/errors.js";
import type { TaskService } from "../domain/task/service.js";
import { WorkError } from "../domain/work/errors.js";
import type { IngestResult, WorkRequest } from "../domain/work/contract.js";
import type { WorkerService } from "../domain/work/worker-service.js";
import type { Db } from "../store/database.js";
import type { AgentRecord } from "../store/repositories/agent.js";

export const CONSOLE_MCP_VERSION = "0.1.0";

/** 与 proxy 侧一致的极小日志面;app.log 满足该形状 */
export interface ConsoleLogger {
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

/** 控制台自有控制工具的共享依赖;服务实例由路由装配时注入 */
export interface ConsoleToolDeps {
  db: Db;
  tasks: TaskService;
  a2a: A2aService;
  /** work 域承接服务:assignment/input 的领取、ACK 与退回 */
  workers: WorkerService;
  /** bug 上报与人工裁决经同一 ingest 事务落账 */
  ingest: (request: WorkRequest) => Promise<IngestResult>;
  /** 事件时间戳时钟;缺省取系统时钟 */
  now?: () => number;
  /** kb_write 的 Markdown 真相源目录 */
  knowledgeDir: string;
  /** 协作播报;HTTP 路由与 /mcp 共用同一收敛点,群未配置时不入队 */
  announce: AnnounceOptions;
}

/** 对外裸名(无前缀),闸门用点分名;身份一律取 Bearer,模型自述字段在 execute 内被丢弃 */
export interface ConsoleTool {
  name: string;
  gateName: string;
  description: string;
  inputSchema: Tool["inputSchema"];
  /** 审计落库的任务归属;无任务维度(task.create / a2a.inbox / kb.search)为 null */
  auditTaskId(args: Readonly<Record<string, unknown>>): string | null;
  execute(agent: AgentRecord, args: Record<string, unknown>): Promise<CallToolResult>;
}

export function textResult(body: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** 只挑白名单字段:模型塞进来的 agent_id / assignee / from / round 一律丢弃 */
export function pick(
  args: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    if (args[key] !== undefined) {
      body[key] = args[key];
    }
  }
  return body;
}

/** 非空字符串取值;缺失、空串或类型不符都视为未提供 */
export function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 同 optionalText,但显式 null 透传(null 语义是「清空」,与「未提供」不同) */
export function nullableText(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return optionalText(value);
}

/** 数字取值;显式 null 透传(null 语义是「清空」,与「未提供」不同) */
export function optionalNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

interface DomainFailure {
  code: string;
  message: string;
  readonly detail?: unknown;
}

function isDomainFailure(error: unknown): error is DomainFailure {
  return (
    error instanceof TaskError ||
    error instanceof A2aError ||
    error instanceof KnowledgeError ||
    error instanceof WorkError
  );
}

/** 领域错误映射为模型可读的 `code: message`;委派白名单拒绝时附可达目标,tool 层据此告诉模型该找谁 */
export function failureResult(error: unknown): CallToolResult {
  if (isDomainFailure(error)) {
    const targets = (error.detail as { allowedTargets?: unknown } | undefined)?.allowedTargets;
    const suffix = Array.isArray(targets)
      ? `;可达目标: [${targets.map((item) => String(item)).join(", ")}]`
      : "";
    return errorResult(`${error.code}: ${error.message}${suffix}`);
  }
  return errorResult(
    `控制台工具执行失败:${error instanceof Error ? error.message : String(error)}`,
  );
}
