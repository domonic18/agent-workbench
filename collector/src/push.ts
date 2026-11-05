import type { ConsoleClient, OutgoingEvent } from "./http.js";
import type { Logger } from "./log.js";
import type { PersistedState } from "./state.js";
import type { Spool, SpoolEntry } from "./spool.js";

export interface Backoff {
  attempt: number;
  nextAt: number;
}

export interface Pusher {
  pushAll(): Promise<void>;
}

interface PushDeps {
  spool: Spool;
  state: PersistedState;
  client: ConsoleClient;
  batchMax: number;
  collectorId: string;
  logger: Logger;
  now: () => number;
  isRunning: () => boolean;
}

export function createPusher(deps: PushDeps): Pusher {
  const { spool, state, client, batchMax, collectorId, logger, now, isRunning } = deps;
  const backoff = new Map<string, Backoff>();

  function projectForStream(streamId: string): string | null {
    for (const entry of spool.pending(streamId)) {
      const stream = state.streams[entry.session_id];
      if (stream !== undefined) {
        return stream.status === "ok" ? stream.project : null;
      }
      return entry.project;
    }
    return null;
  }

  function toOutgoingEvent(entry: SpoolEntry): OutgoingEvent {
    return {
      seq: entry.seq,
      inode: entry.inode,
      offset: entry.offset,
      kind: entry.kind,
      occurred_at: entry.occurred_at,
      payload: entry.payload,
    };
  }

  async function pushStream(streamId: string): Promise<void> {
    const at = now();
    const wait = backoff.get(streamId);
    if (wait !== undefined && wait.nextAt > at) {
      return;
    }
    const project = projectForStream(streamId);
    if (project === null) {
      return;
    }
    const entries = spool.head(streamId, batchMax);
    if (entries.length === 0) {
      return;
    }
    const batch = entries.map(toOutgoingEvent);
    try {
      const response = await client.postBatch({
        collector_id: collectorId,
        agent_project: project,
        stream_id: streamId,
        batch,
        sent_at: now(),
      });
      spool.ack(streamId, response.acked_seq);
      backoff.delete(streamId);
      for (const entry of entries) {
        const stream = state.streams[entry.session_id];
        if (stream !== undefined && response.acked_seq >= entry.seq) {
          stream.ackedSeq = Math.max(stream.ackedSeq, entry.seq);
          stream.lastError = null;
        }
      }
      logger.debug("批次已确认", { streamId, acked: response.acked_seq, size: batch.length });
      if ((response.rejected ?? 0) > 0) {
        logger.warn("批次内坏项被服务端跳过,未入库", {
          streamId,
          rejected: response.rejected ?? 0,
        });
      }
    } catch (error) {
      const previous = backoff.get(streamId)?.attempt ?? 0;
      const attempt = previous + 1;
      const base = Math.min(60_000, 1_000 * 2 ** (attempt - 1));
      const delay = Math.round(base * (0.8 + Math.random() * 0.4));
      backoff.set(streamId, { attempt, nextAt: now() + delay });
      const message = error instanceof Error ? error.message : String(error);
      for (const entry of entries) {
        const stream = state.streams[entry.session_id];
        if (stream !== undefined) {
          stream.lastError = message;
        }
      }
      logger.warn("批次推送失败,退避重试", { streamId, attempt, delay, error: message });
    }
  }

  async function pushAll(): Promise<void> {
    for (const streamId of spool.streams()) {
      if (!isRunning()) {
        return;
      }
      await pushStream(streamId);
    }
  }

  return { pushAll };
}
