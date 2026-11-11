import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import type { DeliveredAgentConfig } from "../../src/shared/aw-node-wire.js";
import type { ConsoleClient } from "./http.js";
import { createLogger, type Logger } from "./log.js";

/** Claude Code 本地作用域里的受管 MCP server 名,Agent 直连控制台 /mcp(04 §8) */
export const MCP_SERVER_NAME = "aw-console";

export interface AppliedAgentState {
  version: number;
  project: string;
  key: string;
  cwd: string;
  /** 本机落地的 Agent 明文密钥片段;仅存本机 0600 状态文件,不进日志与命令行 */
  secret?: string;
}

export interface ConfigSyncState {
  agents: Record<string, AppliedAgentState>;
  lastSyncAt: number | null;
}

const STATE_FILE = "config-state.json";

export function loadConfigSyncState(stateDir: string): ConfigSyncState {
  const path = join(stateDir, STATE_FILE);
  if (!existsSync(path)) {
    return { agents: {}, lastSyncAt: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ConfigSyncState>;
    if (typeof parsed.agents === "object" && parsed.agents !== null) {
      return { agents: parsed.agents, lastSyncAt: parsed.lastSyncAt ?? null };
    }
  } catch {
    // 损坏按空态处理,由下一次同步重建
  }
  return { agents: {}, lastSyncAt: null };
}

export function saveConfigSyncState(stateDir: string, state: ConfigSyncState): void {
  writeFileSync(join(stateDir, STATE_FILE), JSON.stringify(state, null, 2), { mode: 0o600 });
}

/**
 * 从 claude.json 回填 Agent 明文密钥:早期落盘的状态文件没存 secret,
 * 但受管 MCP 头里已是 `Bearer {agentId}.{secret}`。按 agent_id 前缀自校验,
 * 只认本 Agent 那一条;文件损坏只记日志跳过(claude CLI 频繁改写该文件)。
 * 回填后由调用方落盘(状态文件 0600,与 claude.json 同级敏感度)。
 */
export function backfillAgentSecrets(
  state: ConfigSyncState,
  claudeJsonPath: string,
  logger: Logger,
): number {
  const missing = Object.entries(state.agents).filter(([, agent]) => agent.secret === undefined);
  if (missing.length === 0 || !existsSync(claudeJsonPath)) {
    return 0;
  }
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(readFileSync(claudeJsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    logger.warn("claude.json 解析失败,密钥回填跳过");
    return 0;
  }
  const projects = (doc.projects ?? {}) as Record<string, Record<string, unknown>>;
  let filled = 0;
  for (const [agentId, agent] of missing) {
    const project = (projects[agent.cwd] ?? {}) as Record<string, unknown>;
    const servers = (project.mcpServers ?? {}) as Record<string, unknown>;
    const server = (servers[MCP_SERVER_NAME] ?? {}) as Record<string, unknown>;
    const headers = (server.headers ?? {}) as Record<string, unknown>;
    const auth = headers.authorization;
    if (typeof auth !== "string") {
      continue;
    }
    const prefix = `Bearer ${agentId}.`;
    if (!auth.startsWith(prefix)) {
      continue;
    }
    agent.secret = auth.slice(prefix.length);
    filled += 1;
  }
  if (filled > 0) {
    logger.info("已从 claude.json 回填 Agent 密钥", { agents: filled });
  }
  return filled;
}

/**
 * 受管 MCP 条目写入 Claude Code 本地作用域(claude.json projects[cwd].mcpServers):
 * 先备份原文件,再 tmp+rename 原子落盘;只动 aw-console 一个 server,其余内容原样保留。
 * 明文 Bearer 只落本文件(0600),不进日志与命令行。
 */
export function applyManagedMcp(
  claudeJsonPath: string,
  input: { cwd: string; url: string; bearer: string; serverName?: string },
): void {
  const serverName = input.serverName ?? MCP_SERVER_NAME;
  let doc: Record<string, unknown> = {};
  let mode = 0o600;
  if (existsSync(claudeJsonPath)) {
    try {
      doc = JSON.parse(readFileSync(claudeJsonPath, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(`claude.json 解析失败,拒绝改写: ${claudeJsonPath}`);
    }
    mode = statSync(claudeJsonPath).mode & 0o777;
    copyFileSync(claudeJsonPath, `${claudeJsonPath}.aw-backup`);
  }

  const projects = (doc.projects ?? {}) as Record<string, Record<string, unknown>>;
  const project = (projects[input.cwd] ?? {}) as Record<string, unknown>;
  const servers = (project.mcpServers ?? {}) as Record<string, unknown>;
  servers[serverName] = {
    type: "http",
    url: input.url,
    headers: { authorization: `Bearer ${input.bearer}` },
  };
  project.mcpServers = servers;
  projects[input.cwd] = project;
  doc.projects = projects;

  mkdirSync(dirname(claudeJsonPath), { recursive: true });
  const tmp = `${claudeJsonPath}.aw-tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode });
  renameSync(tmp, claudeJsonPath);
}

export interface ConfigSyncDeps {
  client: ConsoleClient;
  stateDir: string;
  /** 控制台根地址,与下发 endpoint 拼成 MCP 完整 URL */
  baseUrl: string;
  claudeJsonPath: string;
  /** 项目名 → 工作目录,来自本机最新发现扫描 */
  cwdByProject: ReadonlyMap<string, string>;
  logger?: Logger;
  now?: () => number;
}

/**
 * 受管 MCP 条目跟随 cwd 自迁移(M3.12):cc-connect 配置里的目录挪动后,
 * 用本地已持有密钥把 claude.json 的 aw-console 条目写到新目录,不等控制台轮换。
 * 成功即更新状态文件里的 agent.cwd(语义:已应用 MCP 条目的 cwd);旧键保留无害。
 * 仅本地参与,无需控制台配合——密钥失效的情况由 auth_stale 自愈闭环兜底。
 */
export function migrateCwds(
  stateDir: string,
  claudeJsonPath: string,
  baseUrl: string,
  cwdByProject: ReadonlyMap<string, string>,
  logger: Logger,
): number {
  const state = loadConfigSyncState(stateDir);
  let migrated = 0;
  for (const [agentId, agent] of Object.entries(state.agents)) {
    if (agent.secret === undefined) {
      continue;
    }
    const freshCwd = cwdByProject.get(agent.project);
    if (freshCwd === undefined || freshCwd === agent.cwd) {
      continue;
    }
    // MCP endpoint 与下发侧一致取 /mcp(config-delivery 默认值);自定义 endpoint
    // 的少见场景由下一次轮换路径按下发值重写,此处不阻塞迁移
    applyManagedMcp(claudeJsonPath, {
      cwd: freshCwd,
      url: `${baseUrl}/mcp`,
      bearer: `${agentId}.${agent.secret}`,
    });
    agent.cwd = freshCwd;
    migrated += 1;
  }
  if (migrated > 0) {
    saveConfigSyncState(stateDir, state);
    logger.info("受管 MCP 条目已跟随工作目录自迁移", { migrated });
  }
  return migrated;
}

export interface SyncSummary {
  status: string;
  rotated: number;
  applied: number;
  skippedProjects: string[];
  acked: boolean;
  /** 控制台请求刷新 bot 名:调用方据此清缓存并立即重取上报 */
  refreshBotNames: boolean;
}

/**
 * 单轮配置同步(04 §8):拉取 → 轮换者原子写入 claude.json → 回执版本。
 * ACK 前响应丢失由服务端轮换语义兜底:下一轮拉到新密钥覆盖旧值再回执。
 * 无 cwd 的项目跳过且不回执,机器停在 delivered,等发现结果补齐。
 */
export async function syncConfigOnce(deps: ConfigSyncDeps): Promise<SyncSummary> {
  const logger = deps.logger ?? createLogger();
  const now = deps.now ?? Date.now;
  const pulled = await deps.client.pullConfig();

  const state = loadConfigSyncState(deps.stateDir);
  const acks: Array<{ agent_id: string; config_version: number }> = [];
  const skippedProjects: string[] = [];
  let applied = 0;

  for (const agent of pulled.agents) {
    if (!agent.rotated || agent.secret === undefined) {
      continue;
    }
    const cwd = deps.cwdByProject.get(agent.project);
    if (cwd === undefined) {
      skippedProjects.push(agent.project);
      continue;
    }
    applyManagedMcp(deps.claudeJsonPath, {
      cwd,
      url: `${deps.baseUrl}${agent.mcp.endpoint}`,
      bearer: `${agent.agent_id}.${agent.secret}`,
    });
    state.agents[agent.agent_id] = {
      version: agent.config_version,
      project: agent.project,
      key: agent.key,
      cwd,
      secret: agent.secret,
    };
    acks.push({ agent_id: agent.agent_id, config_version: agent.config_version });
    applied += 1;
  }

  let acked = false;
  if (acks.length > 0) {
    try {
      const result = await deps.client.ackConfig(acks);
      acked = true;
      logger.info("配置已写入并回执", { applied: acks.length, status: result.config_status });
    } catch (error) {
      // 版本又被服务端轮换(409)或网络失败:下一轮拉取重写并回执,不视为致命
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("配置回执失败,下一轮重试", { error: message });
    }
  }

  state.lastSyncAt = now();
  saveConfigSyncState(deps.stateDir, state);
  if (skippedProjects.length > 0) {
    logger.warn("发现结果缺少项目工作目录,配置暂缓", { projects: skippedProjects });
  }
  return {
    status: pulled.config_status,
    rotated: pulled.agents.filter((agent: DeliveredAgentConfig) => agent.rotated).length,
    applied,
    skippedProjects,
    acked,
    refreshBotNames: pulled.refresh_bot_names === true,
  };
}
