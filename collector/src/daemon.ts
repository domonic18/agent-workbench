import { statSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { loadAttributionIndex, type AttributionIndex } from "./attribution.js";
import type { CollectorConfig } from "./config.js";
import { ensureStateDirs } from "./config.js";
import {
  createConfigSyncCycle,
  createDiscoveryCycle,
  createHeartbeatCycle,
} from "./cycles.js";
import {
  createConsoleClient,
  type ConsoleClient,
  type OutgoingEvent,
} from "./http.js";
import { createLogger, type Logger } from "./log.js";
import { acquireLock, type SingleInstanceLock } from "./lock.js";
import { appendEvents, ensureStream } from "./scan.js";
import { classifyStream, listSessionFiles } from "./sessions.js";
import { Spool } from "./spool.js";
import {
  loadState,
  saveState,
  type PersistedState,
} from "./state.js";
import { readNewLines } from "./tailer.js";

const ATTRIBUTION_TTL_MS = 60_000;

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
  const discovery = createDiscoveryCycle({ configs: config.ccConnectConfigs, client, logger });
  const configSync = createConfigSyncCycle({
    client,
    stateDir: config.stateDir,
    baseUrl: config.baseUrl,
    claudeJsonPath: config.claudeJsonPath,
    cwdByProject: discovery.cwdByProject,
    logger,
    now,
  });
  const heartbeat = createHeartbeatCycle({
    client,
    spool,
    state,
    registered,
    startedAt,
    logger,
    now,
  });
  let lock: SingleInstanceLock | null = null;
  let index: AttributionIndex = loadAttributionIndex(config.ccConnectDir);
  let indexAt = 0;
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let discoveryTimer: ReturnType<typeof setInterval> | null = null;
  let configSyncTimer: ReturnType<typeof setInterval> | null = null;
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

  async function scanOnce(): Promise<void> {
    refreshIndex();
    for (const file of listSessionFiles(config.claudeDir)) {
      const stream = ensureStream(file, state, config, now);
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
        appendEvents(stream, result.lines, spool, now);
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
    if (discoveryTimer !== null) {
      clearInterval(discoveryTimer);
      discoveryTimer = null;
    }
    if (configSyncTimer !== null) {
      clearInterval(configSyncTimer);
      configSyncTimer = null;
    }
    saveState(config.stateDir, state);
    lock?.release();
    lock = null;
    logger.info("采集器已停止", { streams: Object.keys(state.streams).length });
    stopping?.();
  }

  async function start(): Promise<void> {
    // 每机单 aw-node:拿不到锁直接失败退出,launchd 不会误拉起第二份副作用
    lock = acquireLock(config.stateDir);
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

    await heartbeat.once();
    heartbeatTimer = setInterval(() => {
      void heartbeat.once();
    }, config.heartbeatMs);
    await discovery.once();
    discoveryTimer = setInterval(() => {
      void discovery.once();
    }, config.discoveryMs);
    await configSync.once();
    configSyncTimer = setInterval(() => {
      void configSync.once();
    }, config.configSyncMs);
    void loop();
    await stopped;
  }

  return { start, runOnce, stop };
}
