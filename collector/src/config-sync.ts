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

export interface SyncSummary {
  status: string;
  rotated: number;
  applied: number;
  skippedProjects: string[];
  acked: boolean;
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
  };
}
