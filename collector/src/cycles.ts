import { createHash } from "node:crypto";
import { freemem, loadavg, totalmem } from "node:os";
import type { ExtraProject } from "./config.js";
import { mergeExtraProjects, scanDiscoveryState } from "./discovery.js";
import {
  createCachedFeishuBotResolver,
  type CachedFeishuBotResolver,
} from "./feishu-bot.js";
import { migrateCwds, syncConfigOnce, type ConfigSyncDeps } from "./config-sync.js";
import type { DispatchStatusEntry } from "./dispatch-status.js";
import type { ConsoleClient } from "./http.js";
import { createLogger, type Logger } from "./log.js";
import { Spool } from "./spool.js";
import { sortedStreams, streamIdFor, type PersistedState } from "./state.js";

export interface DiscoveryCycleDeps {
  /** cc-connect 配置文件列表(空走默认候选路径) */
  configs: string[];
  /** AW_EXTRA_PROJECTS 声明的额外项目,并入上报与 cwdByProject */
  extraProjects?: readonly ExtraProject[];
  client: ConsoleClient;
  logger?: Logger;
  /** bot 身份解析器;测试可注入假实现,缺省用带缓存的飞书实现 */
  resolver?: CachedFeishuBotResolver;
}

export interface DiscoveryCycle {
  /** 本机扫描:内容有变化才上报,顺带刷新项目→cwd 映射(04 §8) */
  once(): Promise<void>;
  /** 清空 bot 名缓存并立即重取上报,供控制台「刷新 bot 名」触发 */
  refreshBotNames(): Promise<void>;
  /** 项目名 → 工作目录,供配置同步与预填 */
  cwdByProject: ReadonlyMap<string, string>;
}

export function createDiscoveryCycle(deps: DiscoveryCycleDeps): DiscoveryCycle {
  const logger = deps.logger ?? createLogger();
  const resolver = deps.resolver ?? createCachedFeishuBotResolver();
  const cwdByProject = new Map<string, string>();
  let discoveryHash: string | null = null;

  async function once(): Promise<void> {
    const scanned = scanDiscoveryState(deps.configs);
    const report = mergeExtraProjects(scanned.report, deps.extraProjects ?? []);
    const feishuCredentials = scanned.feishuCredentials;
    // 飞书 bot 名只作为展示字段补充,取不到就保留项目名,不阻断发现上报
    await Promise.all(
      report.projects.map(async (project) => {
        const cred = feishuCredentials.get(project.name);
        if (cred === undefined) {
          return;
        }
        const identity = await resolver.resolve(cred.appId, cred.appSecret, project.name);
        if (identity === undefined) {
          logger.warn("飞书 bot 名获取失败,保留项目名", { project: project.name });
          return;
        }
        project.feishu_bot_name = identity.name;
        project.feishu_bot_open_id = identity.openId;
      }),
    );
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

  async function refreshBotNames(): Promise<void> {
    resolver.invalidateAll();
    discoveryHash = null;
    await once();
  }

  return { once, refreshBotNames, cwdByProject };
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
  /** 拉取响应携带刷新 bot 名信号时回调,daemon 接到 discovery 的 refreshBotNames */
  onRefreshBotNames?: () => Promise<void> | void;
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
      // MCP 条目先跟随最新 cwd 自迁移(本地密钥即可,不等控制台轮换),再走正常拉取
      migrateCwds(deps.stateDir, deps.claudeJsonPath, deps.baseUrl, deps.cwdByProject, logger);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("MCP 条目跟随工作目录迁移失败,下轮重试", { error: message });
    }
    try {
      const summary = await syncConfigOnce(syncDeps);
      if (summary.refreshBotNames && deps.onRefreshBotNames !== undefined) {
        logger.info("控制台请求刷新 bot 名,立即重取");
        await deps.onRefreshBotNames();
      }
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
  /** 取走并清空「自上一跳以来有新字节的流」(L2 观测续命,04 §2);心跳失败即弃,
   *  流继续写会被下一轮扫描重新标记,流停写则本就不该再豁免 */
  activeStreams: () => string[];
  /** 采集器自身版本:心跳回报,控制台据此展示运行版本与升级提示 */
  collectorVersion: string;
  /** 派发状态快照(M3.12):被挡项目随心跳上报;缺省不携带,旧版控制台兼容 */
  dispatchStatus?: { snapshot(): DispatchStatusEntry[] };
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
      const dispatch = deps.dispatchStatus?.snapshot() ?? [];
      const response = await deps.client.postHeartbeat({
        uptime: Math.round((now() - deps.startedAt) / 1000),
        pending_bytes: deps.spool.pendingBytes(),
        unattributed_streams: unattributedCount(),
        cpu: Math.round(loadavg()[0]! * 100) / 100,
        mem: Math.round((1 - freemem() / totalmem()) * 100) / 100,
        last_error: logger.lastError(),
        streams: streamSummaries(),
        active_streams: deps.activeStreams(),
        collector_version: deps.collectorVersion,
        // 空快照省略字段:旧版控制台 zod 不拒可选项,新旧互兼容
        ...(dispatch.length > 0 ? { dispatch } : {}),
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
