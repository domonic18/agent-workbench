import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

export type StreamStatus = "ok" | "ambiguous" | "unattributed" | "unregistered";

export interface StreamState {
  sessionId: string;
  path: string;
  project: string | null;
  status: StreamStatus;
  inode: number;
  /** 已消费到的文件字节偏移;偏移之前的行都已落 spool */
  offset: number;
  /** 文件轮转/截断计数,用于生成新的 stream_id */
  epoch: number;
  /** 已确认的最大 seq;仅用于展示与 compaction 参考 */
  ackedSeq: number;
  lastSeq: number;
  lastError: string | null;
  updatedAt: number;
}

export interface PersistedState {
  version: 1;
  streams: Record<string, StreamState>;
}

export function emptyState(): PersistedState {
  return { version: 1, streams: {} };
}

export function streamIdFor(sessionId: string, epoch: number): string {
  return epoch === 0 ? `claude-session:${sessionId}` : `claude-session:${sessionId}:r${epoch}`;
}

function statePath(stateDir: string): string {
  return join(stateDir, "state", "streams.json");
}

function isStreamState(value: unknown): value is StreamState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === "string" &&
    typeof record.path === "string" &&
    typeof record.status === "string" &&
    typeof record.inode === "number" &&
    typeof record.offset === "number" &&
    typeof record.epoch === "number"
  );
}

export function loadState(stateDir: string): PersistedState {
  let raw: string;
  try {
    raw = readFileSync(statePath(stateDir), "utf8");
  } catch {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const streams = parsed.streams;
    if (typeof streams !== "object" || streams === null) {
      return emptyState();
    }
    const result: PersistedState = { version: 1, streams: {} };
    for (const [key, value] of Object.entries(streams)) {
      if (isStreamState(value)) {
        result.streams[key] = value;
      }
    }
    return result;
  } catch {
    return emptyState();
  }
}

/** tmp + rename,避免半截 JSON 让下次启动丢全部断点 */
export function saveState(stateDir: string, state: PersistedState): void {
  const path = statePath(stateDir);
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(state));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export function sortedStreams(state: PersistedState): StreamState[] {
  return Object.values(state.streams).sort((a, b) => a.path.localeCompare(b.path));
}
