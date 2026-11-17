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

/** 状态文件格式版本;2 起按物理文件(路径)记录断点,1 是按 sessionId */
export const STATE_VERSION = 2;

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
  version: 2;
  /**
   * 键=会话文件的物理路径。
   *
   * 同一个会话 uuid 可能同时存在多份副本(换工作区、跨目录续接、拷贝备份都会产生),
   * 副本之间 inode 不同、内容高度重叠。按 uuid 记单条断点会让两份副本轮流把对方的
   * inode 顶掉,每轮扫描都被判成「文件轮转」→ 断点归零 → 整份文件重读重推,
   * 服务端因流 id 变了无法去重,同一份内容被无限次重复入库。
   * 按物理路径记,每份文件各有断点,互不干扰。
   */
  streams: Record<string, StreamState>;
}

export function emptyState(): PersistedState {
  return { version: STATE_VERSION, streams: {} };
}

export interface LoadedState {
  state: PersistedState;
  /** 旧格式状态已迁移:待推送队列里的流 id 语义已变,调用方应清空 spool */
  migrated: boolean;
}

export function streamIdFor(sessionId: string, epoch: number): string {
  return epoch === 0 ? `claude-session:${sessionId}` : `claude-session:${sessionId}:r${epoch}`;
}

/** 同一会话 uuid 可能有多份副本(按物理路径各一条断点);按 sessionId 找全部副本 */
export function streamsBySession(state: PersistedState, sessionId: string): StreamState[] {
  return Object.values(state.streams).filter((stream) => stream.sessionId === sessionId);
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

export function loadState(stateDir: string): LoadedState {
  let raw: string;
  try {
    raw = readFileSync(statePath(stateDir), "utf8");
  } catch {
    return { state: emptyState(), migrated: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 文件坏了:断点从零开始(spool 里的事件仍可重推,服务端会去重)
    return { state: emptyState(), migrated: false };
  }
  const record = parsed as Record<string, unknown>;
  const version = typeof record.version === "number" ? record.version : 1;
  const streams = record.streams;
  if (typeof streams !== "object" || streams === null) {
    return { state: emptyState(), migrated: version !== STATE_VERSION };
  }
  const entries = Object.entries(streams).filter((entry): entry is [string, StreamState] =>
    isStreamState(entry[1]),
  );
  if (version === STATE_VERSION) {
    const result = emptyState();
    for (const [key, value] of entries) {
      result.streams[key] = value;
    }
    return { state: result, migrated: false };
  }
  return { state: migrateToCurrent(entries), migrated: true };
}

/**
 * v1 → v2:键从 sessionId 改成物理路径,epoch 归零。
 *
 * v1 里一个 uuid 只有一条记录(路径被最后一次扫描覆盖),迁移后:
 * ① 该路径的断点保留,继续从原偏移读;
 * ② epoch 归零 → 流 id 回到 claude-session:<uuid>,不再产生 :rN 代次流;
 * ③ 同一 uuid 的其它副本没有记录,会以「断点=文件末尾」登记,不会回补历史。
 */
function migrateToCurrent(entries: [string, StreamState][]): PersistedState {
  const result = emptyState();
  for (const [, value] of entries) {
    result.streams[value.path] = { ...value, epoch: 0 };
  }
  return result;
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
