import { createHash } from "node:crypto";
import { freemem, loadavg, totalmem } from "node:os";
import { scanDiscovery } from "./discovery.js";
import { syncConfigOnce, type ConfigSyncDeps } from "./config-sync.js";
import type { ConsoleClient } from "./http.js";
import { createLogger, type Logger } from "./log.js";
import { Spool } from "./spool.js";
import { sortedStreams, streamIdFor, type PersistedState } from "./state.js";

export interface DiscoveryCycleDeps {
  /** cc-connect 配置文件列表(空走默认候选路径) */
  configs: string[];
  client: ConsoleClient;
  logger?: Logger;
}

export interface DiscoveryCycle {
  /** 本机扫描:内容有变化才上报,顺带刷新项目→cwd 映射(04 §8) */
  once(): Promise<void>;
  /** 项目名 → 工作目录,供配置同步与预填 */
  cwdByProject: ReadonlyMap<string, string>;
}

export function createDiscoveryCycle(deps: DiscoveryCycleDeps): DiscoveryCycle {
  const logger = deps.logger ?? createLogger();
  const cwdByProject = new Map<string, string>();
  let discoveryHash: string | null = null;

  async function once(): Promise<void> {
    const report = scanDiscovery(deps.configs);
    cwdByProject.clear();
    for (const project of report.projects) {
      if (project.cwd !== undefined) {
        cwdByProject.set(project.name, project.cwd);
      }
    }
    const hash = createHash("sha256").update(JSON.stringify(report)).digest("hex");
    if (hash === discoveryHash) {
      return;
    }
    try {
      await deps.client.postDiscovery(report);
      discoveryHash = hash;
      logger.info("发现上报完成", { projects: report.projects.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("发现上报失败,下轮重试", { error: message });
    }
  }

  return { once, cwdByProject };
}

export interface ConfigSyncCycleDeps {
  client: ConsoleClient;
  stateDir: string;
  /** 控制台根地址,与下发 endpoint 拼成 MCP 完整 URL */
  baseUrl: string;
  claudeJsonPath: string;
  cwdByProject: ReadonlyMap<string, string>;
  logger?: Logger;
  now?: () => number;
}

export interface ConfigSyncCycle {
  /** 拉取→原子写入→ACK(04 §8);失败不致命,下一轮重试 */
  once(): Promise<void>;
}

export function createConfigSyncCycle(deps: ConfigSyncCycleDeps): ConfigSyncCycle {
  const logger = deps.logger ?? createLogger();

  async function once(): Promise<void> {
    const syncDeps: ConfigSyncDeps = {
      client: deps.client,
      stateDir: deps.stateDir,
      baseUrl: deps.baseUrl,
      claudeJsonPath: deps.claudeJsonPath,
      cwdByProject: deps.cwdByProject,
      logger,
    };
    if (deps.now !== undefined) {
      syncDeps.now = deps.now;
    }
    try {
      await syncConfigOnce(syncDeps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("配置同步失败,下轮重试", { error: message });
    }
  }

  return { once };
}

export interface HeartbeatCycleDeps {
  client: ConsoleClient;
  spool: Spool;
  state: PersistedState;
  /** 心跳响应会刷新已登记项目集合 */
  registered: Set<string>;
  startedAt: number;
  logger?: Logger;
  now?: () => number;
}

export interface HeartbeatCycle {
  /** 上报负载与积压,并同步已登记项目;失败不致命,下一轮重试 */
  once(): Promise<void>;
}

export function createHeartbeatCycle(deps: HeartbeatCycleDeps): HeartbeatCycle {
  const logger = deps.logger ?? createLogger();
  const now = deps.now ?? Date.now;

  function unattributedCount(): number {
    let count = 0;
    for (const stream of Object.values(deps.state.streams)) {
      if (stream.status === "ambiguous" || stream.status === "unregistered") {
        count += 1;
      }
    }
    return count;
  }

  function streamSummaries(): Record<string, unknown>[] {
    return sortedStreams(deps.state)
      .filter(
        (stream) => deps.spool.pending(streamIdFor(stream.sessionId, stream.epoch)).length > 0,
      )
      .slice(0, 100)
      .map((stream) => ({
        stream_id: streamIdFor(stream.sessionId, stream.epoch),
        project: stream.project,
        pending: deps.spool.pending(streamIdFor(stream.sessionId, stream.epoch)).length,
        last_error: stream.lastError,
      }));
  }

  async function once(): Promise<void> {
    try {
      const response = await deps.client.postHeartbeat({
        uptime: Math.round((now() - deps.startedAt) / 1000),
        pending_bytes: deps.spool.pendingBytes(),
        unattributed_streams: unattributedCount(),
        cpu: Math.round(loadavg()[0]! * 100) / 100,
        mem: Math.round((1 - freemem() / totalmem()) * 100) / 100,
        last_error: logger.lastError(),
        streams: streamSummaries(),
      });
      const next = new Set(response.projects);
      if (next.size > 0) {
        deps.registered.clear();
        for (const project of next) {
          deps.registered.add(project);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("心跳失败", { error: message });
    }
  }

  return { once };
}
