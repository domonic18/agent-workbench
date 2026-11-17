import { statSync } from "node:fs";
import type { CollectorConfig } from "./config.js";
import { mapLine } from "./mapper.js";
import { Spool } from "./spool.js";
import { streamIdFor, type PersistedState, type StreamState } from "./state.js";
import type { SessionFile } from "./sessions.js";

const SEQ_PER_LINE = 100;

export function ensureStream(
  file: SessionFile,
  state: PersistedState,
  config: CollectorConfig,
  now: () => number,
): StreamState {
  const existing = state.streams[file.path];
  if (existing !== undefined) {
    return existing;
  }
  let inode = 0;
  let size = 0;
  try {
    const stat = statSync(file.path);
    inode = stat.ino;
    size = stat.size;
  } catch {
    // 文件刚被删/轮转,按空流登记
  }
  const created: StreamState = {
    sessionId: file.sessionId,
    path: file.path,
    project: null,
    status: "unattributed",
    inode,
    offset: config.backfill === "all" ? 0 : size,
    epoch: 0,
    ackedSeq: 0,
    lastSeq: 0,
    lastError: null,
    updatedAt: now(),
  };
  state.streams[file.path] = created;
  return created;
}

/**
 * 清掉文件已消失的状态条目(项目目录被删、会话文件被清理)。
 * 返回清理条数;留下的条目都会在下一轮扫描被 ensureStream 复用。
 */
export function pruneStreams(state: PersistedState, livePaths: ReadonlySet<string>): number {
  let removed = 0;
  for (const key of Object.keys(state.streams)) {
    if (!livePaths.has(key)) {
      delete state.streams[key];
      removed += 1;
    }
  }
  return removed;
}

export function appendEvents(
  stream: StreamState,
  lines: { text: string; startOffset: number }[],
  spool: Spool,
  now: () => number,
): void {
  for (const line of lines) {
    const events = mapLine(line.text, now());
    const spoolable =
      stream.status === "ok" || stream.status === "ambiguous" || stream.status === "unregistered";
    if (!spoolable) {
      continue;
    }
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (event === undefined) {
        continue;
      }
      const seq = line.startOffset * SEQ_PER_LINE + i + 1;
      if (seq <= stream.lastSeq) {
        continue;
      }
      spool.append({
        stream_id: streamIdFor(stream.sessionId, stream.epoch),
        session_id: stream.sessionId,
        project: stream.status === "ok" ? stream.project : null,
        seq,
        inode: stream.inode,
        offset: line.startOffset,
        kind: event.kind,
        occurred_at: event.occurredAt,
        payload: event.payload,
      });
      stream.lastSeq = seq;
    }
  }
}
