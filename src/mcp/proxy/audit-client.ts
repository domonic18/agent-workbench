import type { ToolCallAudit } from "../../shared/audit.js";
import { callConsole, type ConsoleClientConfig } from "./console-client.js";

const AUDIT_TIMEOUT_MS = 10_000;

function errorDetail(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return "";
  }
  const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
  if (error === undefined) {
    return "";
  }
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  return code === "" && message === "" ? "" : `:${code} ${message}`;
}

/**
 * 审计经控制面路由落库,proxy 不再跨进程开库(05 §6.4)。
 * 失败一律抛错——上层据此拒绝执行,不允许「先跑后记」。
 */
export async function postToolCallAudit(
  config: ConsoleClientConfig,
  entry: ToolCallAudit,
): Promise<void> {
  const response = await callConsole(config, {
    method: "POST",
    path: "/api/audit/tool-calls",
    body: entry,
    timeoutMs: AUDIT_TIMEOUT_MS,
  });
  if (response.status >= 200 && response.status < 300) {
    return;
  }
  throw new Error(
    `控制台审计写入失败(HTTP ${response.status})${errorDetail(response.body)}`,
  );
}
