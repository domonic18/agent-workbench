import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const COLLECTOR_VERSION = "0.1.0";

export type BackfillMode = "none" | "all";

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
  pollMs: number;
  heartbeatMs: number;
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

function parseProjects(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
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
  const stateDir = env.AW_STATE_DIR ?? join(homedir(), ".aw-collector");

  return {
    ingestUrl: url.ingestUrl,
    baseUrl: url.baseUrl,
    collectorId: requireAuth ? requireText(env, "AW_COLLECTOR_ID") : (env.AW_COLLECTOR_ID ?? ""),
    secret: requireAuth ? requireText(env, "AW_COLLECTOR_SECRET") : (env.AW_COLLECTOR_SECRET ?? ""),
    registeredProjects: parseProjects(env.AW_AGENT_PROJECTS),
    stateDir,
    claudeDir: env.AW_CLAUDE_DIR ?? join(homedir(), ".claude"),
    ccConnectDir: env.AW_CC_CONNECT_DIR ?? join(homedir(), ".cc-connect"),
    pollMs: readInt(env, "AW_POLL_MS", 1_000, 100, 10 * 60 * 1_000),
    heartbeatMs: readInt(env, "AW_HEARTBEAT_MS", 60_000, 5_000, 60 * 60 * 1_000),
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
