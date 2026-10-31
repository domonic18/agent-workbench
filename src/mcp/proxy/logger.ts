import type { ProxyLogger } from "./types.js";

function write(level: string, data: Record<string, unknown>, message: string): void {
  process.stderr.write(`${JSON.stringify({ level, msg: message, ...data })}\n`);
}

/** 代理进程的 stdout 被 MCP 协议占用,日志只能走 stderr */
export function createStderrLogger(): ProxyLogger {
  return {
    info: (data, message) => write("info", data, message),
    warn: (data, message) => write("warn", data, message),
    error: (data, message) => write("error", data, message),
  };
}
