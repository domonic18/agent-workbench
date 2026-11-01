import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface AttributionIndex {
  /** session uuid(小写)→ cc-connect 项目名,一个 id 可能命中多个项目 */
  resolve(sessionId: string): string[];
  /** 索引中不同项目数,供 doctor 展示 */
  projects(): string[];
  /** 关注的 session id 总数 */
  sessionCount(): number;
}

const SESSION_FILE = /^(.*)_[0-9a-f]{8}\.json$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 项目名取文件名最后一个 `_<8hex>` 之前的部分,不按目录名猜 */
export function projectFromSessionFile(fileName: string): string | null {
  const match = SESSION_FILE.exec(fileName);
  if (match === null || match[1] === undefined) {
    return null;
  }
  return match[1];
}

function collectIds(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    if (UUID.test(value)) {
      into.add(value.toLowerCase());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectIds(item, into);
    }
  }
}

function collectSessionIds(record: unknown, into: Set<string>): void {
  if (typeof record !== "object" || record === null) {
    return;
  }
  const payload = record as Record<string, unknown>;
  collectIds(payload.agent_session_id, into);
  collectIds(payload.past_agent_session_ids, into);
}

export function buildAttributionIndex(entries: Map<string, Set<string>>): AttributionIndex {
  return {
    resolve(sessionId) {
      return [...(entries.get(sessionId.toLowerCase()) ?? [])].sort();
    },
    projects() {
      const all = new Set<string>();
      for (const projects of entries.values()) {
        for (const project of projects) {
          all.add(project);
        }
      }
      return [...all].sort();
    },
    sessionCount() {
      return entries.size;
    },
  };
}

export function loadAttributionIndex(ccConnectDir: string): AttributionIndex {
  const entries = new Map<string, Set<string>>();
  let files: string[];
  try {
    files = readdirSync(join(ccConnectDir, "sessions"));
  } catch {
    return buildAttributionIndex(entries);
  }

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const project = projectFromSessionFile(basename(file));
    if (project === null) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(ccConnectDir, "sessions", file), "utf8"));
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const ids = new Set<string>();
    const sessions = (parsed as Record<string, unknown>).sessions;
    if (typeof sessions === "object" && sessions !== null) {
      for (const session of Object.values(sessions)) {
        collectSessionIds(session, ids);
      }
    }
    collectSessionIds((parsed as Record<string, unknown>).active_session, ids);
    for (const id of ids) {
      const existing = entries.get(id);
      if (existing === undefined) {
        entries.set(id, new Set([project]));
      } else {
        existing.add(project);
      }
    }
  }

  return buildAttributionIndex(entries);
}
