import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const COLLECTOR_VERSION = "0.2.2";

export type BackfillMode = "none" | "all";

/** 不在 cc-connect 配置里的本机项目(AW_EXTRA_PROJECTS),如 worker 靶子仓库 */
export interface ExtraProject {
  name: string;
  cwd: string;
}

export interface CollectorConfig {
  /** 控制台 ingest 完整地址,如 https://aw.example.com/api/ingest */
  ingestUrl: string;
  /** ingest 前缀,用于拼 heartbeat / projects 与 healthz */
  baseUrl: string;
  collectorId: string;
  secret: string;
  registeredProjects: readonly string[];
  stateDir: string;
  claudeDir: string;
  ccConnectDir: string;
  /** cc-connect 配置文件列表(发现扫描用);空数组走默认候选路径 */
  ccConnectConfigs: string[];
  /** 受管 MCP 写入的 Claude Code 配置文件 */
  claudeJsonPath: string;
  /** AW_EXTRA_PROJECTS 声明的额外项目;并入发现上报(带 cwd) */
  extraProjects: ExtraProject[];
  pollMs: number;
  heartbeatMs: number;
  discoveryMs: number;
  configSyncMs: number;
  /** 调度轮询间隔;0 表示关闭 A2A 自动唤醒 */
  dispatchMs: number;
  /** 单次 headless 会话超时;超时后 SIGTERM 再 SIGKILL */
  sessionTimeoutMs: number;
  /** 调度会话使用的模型名;空表示用 claude CLI 默认模型 */
  dispatchModel: string | null;
  /** claude 可执行文件路径;空表示自动探测 */
  dispatchClaude: string | null;
  /** G2 cwd 活跃会话判定窗口(毫秒);窗口内新出现的会话文件视为开发进行中 */
  busySessionWindowMs: number;
  /** G4 机级活跃会话上限(含交互会话);达到后本轮全机不派发 */
  maxMachineSessions: number;
  /** 连续被挡 N 轮后探视退避 5min */
  dispatchBackoffRounds: number;
  /** 单批派工上限;超出部分留在收件箱下一批,防超大 PR 不可评审 */
  batchMaxItems: number;
  batchMax: number;
  backfill: BackfillMode;
  spoolMaxBytes: number;
  requestTimeoutMs: number;
}

export interface ConfigEnv {
  [key: string]: string | undefined;
}

function readInt(
  env: ConfigEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} 必须是 ${min}~${max} 的整数,收到 ${raw}`);
  }
  return parsed;
}

function requireText(env: ConfigEnv, key: string): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`缺少环境变量 ${key}`);
  }
  return raw.trim();
}

/** 可选文本:未设置或空白返回 null,不做默认值 */
function optionalText(env: ConfigEnv, key: string): string | null {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  return raw.trim();
}

function parseList(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** AW_EXTRA_PROJECTS:"name=/abs/cwd" 逗号分隔;格式非法直接报错,不静默丢弃 */
export function parseExtraProjects(raw: string | undefined): ExtraProject[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const extra: ExtraProject[] = [];
  for (const item of raw.split(",")) {
    const entry = item.trim();
    if (entry === "") {
      continue;
    }
    const eq = entry.indexOf("=");
    const name = eq > 0 ? entry.slice(0, eq).trim() : "";
    const cwd = eq > 0 && eq < entry.length - 1 ? entry.slice(eq + 1).trim() : "";
    if (name === "" || !cwd.startsWith("/")) {
      throw new Error(`AW_EXTRA_PROJECTS 条目必须是 name=/绝对路径,收到 ${entry}`);
    }
    extra.push({ name, cwd });
  }
  return extra;
}

/** 接收 base url 或完整 ingest url,统一成完整 ingest 地址 */
export function normalizeIngestUrl(raw: string): { ingestUrl: string; baseUrl: string } {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") {
    throw new Error("AW_INGEST_URL 不能为空");
  }
  const suffix = "/api/ingest";
  const ingestUrl = trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
  return { ingestUrl, baseUrl: ingestUrl.slice(0, -suffix.length) };
}

export function parseBackfill(raw: string | undefined): BackfillMode {
  if (raw === undefined || raw === "" || raw === "none" || raw === "0") {
    return "none";
  }
  if (raw === "all" || raw === "1" || raw === "true") {
    return "all";
  }
  throw new Error(`AW_BACKFILL 只支持 none / all,收到 ${raw}`);
}

export interface LoadConfigOptions {
  env?: ConfigEnv;
  requireAuth?: boolean;
}

export function loadConfig(options: LoadConfigOptions = {}): CollectorConfig {
  const env = options.env ?? process.env;
  const requireAuth = options.requireAuth ?? true;
  const url = normalizeIngestUrl(env.AW_INGEST_URL ?? "http://127.0.0.1:8787");
  const stateDir = env.AW_STATE_DIR ?? join(homedir(), ".aw-node");

  return {
    ingestUrl: url.ingestUrl,
    baseUrl: url.baseUrl,
    collectorId: requireAuth ? requireText(env, "AW_COLLECTOR_ID") : (env.AW_COLLECTOR_ID ?? ""),
    secret: requireAuth ? requireText(env, "AW_COLLECTOR_SECRET") : (env.AW_COLLECTOR_SECRET ?? ""),
    registeredProjects: parseList(env.AW_AGENT_PROJECTS),
    stateDir,
    claudeDir: env.AW_CLAUDE_DIR ?? join(homedir(), ".claude"),
    ccConnectDir: env.AW_CC_CONNECT_DIR ?? join(homedir(), ".cc-connect"),
    ccConnectConfigs: parseList(env.AW_CC_CONNECT_CONFIG),
    claudeJsonPath: env.AW_CLAUDE_JSON ?? join(homedir(), ".claude.json"),
    extraProjects: parseExtraProjects(env.AW_EXTRA_PROJECTS),
    pollMs: readInt(env, "AW_POLL_MS", 1_000, 100, 10 * 60 * 1_000),
    heartbeatMs: readInt(env, "AW_HEARTBEAT_MS", 60_000, 5_000, 60 * 60 * 1_000),
    discoveryMs: readInt(env, "AW_DISCOVERY_MS", 5 * 60_1_000, 30_000, 60 * 60_1_000),
    configSyncMs: readInt(env, "AW_CONFIG_SYNC_MS", 60_000, 10_000, 60 * 60_1_000),
    dispatchMs: readInt(env, "AW_DISPATCH_MS", 30_000, 0, 60 * 60_000),
    sessionTimeoutMs: readInt(env, "AW_SESSION_TIMEOUT_MS", 30 * 60_000, 60_000, 24 * 60 * 60_000),
    dispatchModel: optionalText(env, "AW_DISPATCH_MODEL"),
    dispatchClaude: optionalText(env, "AW_DISPATCH_CLAUDE"),
    busySessionWindowMs:
      readInt(env, "AW_BUSY_SESSION_WINDOW_MIN", 15, 1, 24 * 60) * 60_000,
    maxMachineSessions: readInt(env, "AW_MAX_MACHINE_SESSIONS", 2, 1, 64),
    dispatchBackoffRounds: readInt(env, "AW_DISPATCH_BACKOFF_ROUNDS", 5, 1, 100),
    batchMaxItems: readInt(env, "AW_BATCH_MAX_ITEMS", 8, 1, 64),
    batchMax: readInt(env, "AW_BATCH_MAX", 500, 1, 500),
    backfill: parseBackfill(env.AW_BACKFILL),
    spoolMaxBytes: readInt(env, "AW_SPOOL_MAX_BYTES", 512 * 1024 * 1024, 1024 * 1024, 8 * 1024 * 1024 * 1024),
    requestTimeoutMs: readInt(env, "AW_REQUEST_TIMEOUT_MS", 30_000, 1_000, 120_000),
  };
}

/** 安装脚本与 launchd 共用的状态目录;权限只给当前用户 */
export function ensureStateDirs(stateDir: string): void {
  for (const sub of ["", "state", "spool"]) {
    mkdirSync(join(stateDir, sub), { recursive: true, mode: 0o700 });
  }
}
