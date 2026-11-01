import { readdirSync, statSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import { loadAttributionIndex, type AttributionIndex } from "./attribution.js";
import type { CollectorConfig } from "./config.js";
import { ensureStateDirs } from "./config.js";
import {
  createConsoleClient,
  type ConsoleClient,
  type OutgoingEvent,
} from "./http.js";
import { createLogger, type Logger } from "./log.js";
import { mapLine } from "./mapper.js";
import { Spool } from "./spool.js";
import {
  loadState,
  saveState,
  sortedStreams,
  streamIdFor,
  type PersistedState,
  type StreamState,
  type StreamStatus,
} from "./state.js";
import { readNewLines } from "./tailer.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTRIBUTION_TTL_MS = 60_000;
const SEQ_PER_LINE = 100;

export interface SessionFile {
  sessionId: string;
  path: string;
}

export function listSessionFiles(claudeDir: string): SessionFile[] {
  const root = join(claudeDir, "projects");
  const files: SessionFile[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return files;
  }
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const sessionId = name.slice(0, -".jsonl".length);
      if (UUID.test(sessionId)) {
        files.push({ sessionId: sessionId.toLowerCase(), path: join(root, dir, name) });
      }
    }
  }
  return files;
}

export interface Classification {
  status: StreamStatus;
  project: string | null;
}

export function classifyStream(
  index: AttributionIndex,
  sessionId: string,
  registered: ReadonlySet<string>,
): Classification {
  const projects = index.resolve(sessionId);
  if (projects.length === 0) {
    return { status: "unattributed", project: null };
  }
  if (projects.length > 1) {
    return { status: "ambiguous", project: null };
  }
  const project = projects[0] ?? null;
  if (project === null) {
    return { status: "unattributed", project: null };
  }
  return { status: registered.has(project) ? "ok" : "unregistered", project };
}

interface Backoff {
  attempt: number;
  nextAt: number;
}

export interface DaemonDeps {
  config: CollectorConfig;
  logger?: Logger;
  client?: ConsoleClient;
  now?: () => number;
}

export interface CollectorDaemon {
  /** 常驻运行,收到 SIGTERM / SIGINT 后返回 */
  start(): Promise<void>;
  /** 单轮扫描 + 推送,供测试与 doctor 使用 */
  runOnce(): Promise<void>;
  stop(): void;
}

export function createDaemon(deps: DaemonDeps): CollectorDaemon {
  const { config } = deps;
  const logger = deps.logger ?? createLogger();
  const now = deps.now ?? Date.now;
  const client = deps.client ?? createConsoleClient({
    ingestUrl: config.ingestUrl,
    baseUrl: config.baseUrl,
    collectorId: config.collectorId,
    secret: config.secret,
    timeoutMs: config.requestTimeoutMs,
  });

  ensureStateDirs(config.stateDir);
  const spool = new Spool(join(config.stateDir, "spool"), config.spoolMaxBytes);
  const state: PersistedState = loadState(config.stateDir);
  const registered = new Set(config.registeredProjects);
  const backoff = new Map<string, Backoff>();
  const startedAt = now();
  let index: AttributionIndex = loadAttributionIndex(config.ccConnectDir);
  let indexAt = 0;
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let stopping: (() => void) | null = null;

  spool.load();

  function refreshIndex(): void {
    const at = now();
    if (at - indexAt < ATTRIBUTION_TTL_MS) {
      return;
    }
    index = loadAttributionIndex(config.ccConnectDir);
    indexAt = at;
  }

  function ensureStream(file: SessionFile): StreamState {
    const existing = state.streams[file.sessionId];
    if (existing !== undefined) {
      existing.path = file.path;
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
    state.streams[file.sessionId] = created;
    return created;
  }

  function appendEvents(stream: StreamState, lines: { text: string; startOffset: number }[]): void {
    for (const line of lines) {
      const events = mapLine(line.text, now());
      const spoolable =
        stream.status === "ok" ||
        stream.status === "ambiguous" ||
        stream.status === "unregistered";
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

  async function scanOnce(): Promise<void> {
    refreshIndex();
    const files = listSessionFiles(config.claudeDir);
    for (const file of files) {
      const stream = ensureStream(file);
      const classified = classifyStream(index, file.sessionId, registered);
      if (classified.status !== stream.status || classified.project !== stream.project) {
        stream.status = classified.status;
        stream.project = classified.project;
        stream.updatedAt = now();
      }
      if (classified.status === "unattributed") {
        // 档 3:不推送也不计未归因;跳过历史,等它真的接上 cc-connect 再从当下开始
        try {
          stream.offset = statSync(file.path).size;
          stream.inode = statSync(file.path).ino;
        } catch {
          // 文件消失,保留原断点
        }
        continue;
      }
      const result = readNewLines(file.path, {
        inode: stream.inode,
        offset: stream.offset,
        epoch: stream.epoch,
      });
      if (result.missing) {
        continue;
      }
      if (result.rotated || result.truncated) {
        logger.warn("会话文件已轮转或截断,断点归零", {
          sessionId: stream.sessionId,
          epoch: result.epoch,
        });
        stream.epoch = result.epoch;
        stream.ackedSeq = 0;
        stream.lastSeq = 0;
      }
      stream.inode = result.inode;
      if (result.lines.length > 0) {
        appendEvents(stream, result.lines);
      }
      stream.offset = result.offset;
      stream.updatedAt = now();
    }

    const dropped = spool.enforceLimit();
    if (dropped > 0) {
      logger.error("spool 超过上限,已丢弃最旧的未确认事件", { dropped });
    }
    saveState(config.stateDir, state);
  }

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
    const entries = spool.head(streamId, config.batchMax);
    if (entries.length === 0) {
      return;
    }
    const batch: OutgoingEvent[] = entries.map((entry) => ({
      seq: entry.seq,
      inode: entry.inode,
      offset: entry.offset,
      kind: entry.kind,
      occurred_at: entry.occurred_at,
      payload: entry.payload,
    }));
    try {
      const response = await client.postBatch({
        collector_id: config.collectorId,
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
      if (!running) {
        return;
      }
      await pushStream(streamId);
    }
  }

  function unattributedCount(): number {
    let count = 0;
    for (const stream of Object.values(state.streams)) {
      if (stream.status === "ambiguous" || stream.status === "unregistered") {
        count += 1;
      }
    }
    return count;
  }

  function streamSummaries(): Record<string, unknown>[] {
    return sortedStreams(state)
      .filter((stream) => spool.pending(streamIdFor(stream.sessionId, stream.epoch)).length > 0)
      .slice(0, 100)
      .map((stream) => ({
        stream_id: streamIdFor(stream.sessionId, stream.epoch),
        project: stream.project,
        pending: spool.pending(streamIdFor(stream.sessionId, stream.epoch)).length,
        last_error: stream.lastError,
      }));
  }

  async function heartbeatOnce(): Promise<void> {
    try {
      const response = await client.postHeartbeat({
        uptime: Math.round((now() - startedAt) / 1000),
        pending_bytes: spool.pendingBytes(),
        unattributed_streams: unattributedCount(),
        cpu: Math.round(loadavg()[0]! * 100) / 100,
        mem: Math.round((1 - freemem() / totalmem()) * 100) / 100,
        last_error: logger.lastError(),
        streams: streamSummaries(),
      });
      const next = new Set(response.projects);
      if (next.size > 0) {
        registered.clear();
        for (const project of next) {
          registered.add(project);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("心跳失败", { error: message });
    }
  }

  async function runOnce(): Promise<void> {
    await scanOnce();
    await pushAll();
    saveState(config.stateDir, state);
  }

  async function loop(): Promise<void> {
    if (!running) {
      return;
    }
    try {
      await runOnce();
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      logger.error("采集轮次异常", { error: message });
    }
    timer = setTimeout(() => {
      void loop();
    }, config.pollMs);
  }

  function stop(): void {
    if (!running) {
      return;
    }
    running = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    saveState(config.stateDir, state);
    logger.info("采集器已停止", { streams: Object.keys(state.streams).length });
    stopping?.();
  }

  async function start(): Promise<void> {
    logger.info("采集器启动", {
      collectorId: config.collectorId,
      ingestUrl: config.ingestUrl,
      stateDir: config.stateDir,
      backfill: config.backfill,
      cpus: cpus().length,
    });
    try {
      const projects = await client.getProjects();
      if (projects.length > 0) {
        registered.clear();
        for (const project of projects) {
          registered.add(project);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("启动时拉取已登记项目失败,使用本地配置", { error: message });
    }

    const stopped = new Promise<void>((resolve) => {
      stopping = resolve;
    });
    const onSignal = (signal: string) => {
      logger.info("收到退出信号", { signal });
      stop();
    };
    process.once("SIGTERM", () => onSignal("SIGTERM"));
    process.once("SIGINT", () => onSignal("SIGINT"));

    await heartbeatOnce();
    heartbeatTimer = setInterval(() => {
      void heartbeatOnce();
    }, config.heartbeatMs);
    void loop();
    await stopped;
  }

  return { start, runOnce, stop };
}
