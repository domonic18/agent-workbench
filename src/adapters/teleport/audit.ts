import type { SessionStartEvent, TeleportAuditPort } from "../../domain/capability/ports.js";
import { readFile } from "node:fs/promises";

/** 兼容旧导出;新代码应使用 domain/capability/ports 的 TeleportAuditPort */
export type TeleportAuditAdapter = TeleportAuditPort;

export type { SessionStartEvent };

export interface TeleportAuditConfig {
  auditLogPath: string;
}

interface RawEvent {
  event?: unknown;
  sid?: unknown;
  user?: unknown;
  login?: unknown;
  server_hostname?: unknown;
  time?: unknown;
  user_traits?: Record<string, unknown>;
  aw_task_id?: unknown;
  aw_ticket_id?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** traits 优先取 user_traits.<key>,兼容旧格式直接挂在事件顶层 */
function firstTrait(event: RawEvent, key: "aw_task_id" | "aw_ticket_id"): string | null {
  const value = event.user_traits?.[key] ?? event[key];
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item !== "");
    return typeof first === "string" ? first : null;
  }
  return asString(value) ?? null;
}

function parseTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function parseLine(line: string): SessionStartEvent | undefined {
  let raw: RawEvent;
  try {
    raw = JSON.parse(line) as RawEvent;
  } catch {
    return undefined;
  }
  if (raw.event !== "session.start") {
    return undefined;
  }
  const sid = asString(raw.sid);
  const time = parseTime(raw.time);
  if (sid === undefined || time === undefined) {
    return undefined;
  }
  return {
    sid,
    user: asString(raw.user) ?? "",
    login: asString(raw.login) ?? "",
    serverHostname: asString(raw.server_hostname) ?? "",
    taskId: firstTrait(raw, "aw_task_id"),
    ticketId: firstTrait(raw, "aw_ticket_id"),
    time,
  };
}

export function createTeleportAuditAdapter(
  config: TeleportAuditConfig,
  deps: { readFile?: (path: string) => Promise<string> } = {},
): TeleportAuditPort {
  const read = deps.readFile ?? ((path: string) => readFile(path, "utf8"));
  return {
    async listSessionStarts() {
      let content: string;
      try {
        content = await read(config.auditLogPath);
      } catch (error) {
        throw new Error(
          `Teleport 审计日志不可读(${config.auditLogPath}): ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      const events: SessionStartEvent[] = [];
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") {
          continue;
        }
        const event = parseLine(trimmed);
        if (event !== undefined) {
          events.push(event);
        }
      }
      return events;
    },
  };
}
