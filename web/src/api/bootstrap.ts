import { api, newIdempotencyKey } from "./client.js";

export type BootstrapPhase =
  | "awaiting_admin"
  | "awaiting_machine"
  | "awaiting_agents"
  | "awaiting_completion"
  | "ready";

export interface BootstrapAssembly {
  primaryAgentId: string;
  workKind: string;
  assembledAt: number;
}

export interface BugFixDefinition {
  workKind: string;
  routeRule: {
    ruleId: string;
    source: string;
    kind: string;
    targetRole: string;
  };
  mandate: {
    expectedResult: string;
    scope: string;
  };
  evidence: string[];
}

export interface BootstrapStatus {
  phase: BootstrapPhase;
  machines: number;
  agents: number;
  assembly: BootstrapAssembly | null;
  definition: BugFixDefinition;
  next: string;
}

export interface DiscoveryProjectView {
  name: string;
  cwd?: string | undefined;
  confirmed: boolean;
  feishuBotName?: string | undefined;
}

export interface DiscoveryMachineView {
  machineId: string;
  hostname: string;
  /** 展示名:控制台可改;为空表示与 hostname 相同 */
  displayName: string | null;
  status: string;
  /** 心跳:aw-node 最近一次上报存活的时间 */
  lastSeenAt: number | null;
  /** 发现上报:最近一次上报 cc-connect 发现结果的时间,与心跳不同源 */
  receivedAt: number | null;
  /** 采集器版本:心跳活报,旧版采集器为 enroll 时落的值 */
  collectorVersion: string;
  /** 落后于控制台镜像的最新产物版本 */
  upgradeAvailable: boolean;
  projects: DiscoveryProjectView[];
}

export type PreflightItemStatus = "ok" | "fail" | "not_configured";

export interface PreflightItem {
  key: string;
  status: PreflightItemStatus;
  detail: string;
  hint?: string | undefined;
}

export interface PreflightResult {
  items: PreflightItem[];
  ready: boolean;
}

export interface ConfirmedAgent {
  id: string;
  key: string;
  project: string;
  displayName: string;
}

/** /setup 第 1 步:无会话态,凭一次性 bootstrap token 设置管理员口令并解锁控制台 */
export function bootstrapAdmin(token: string, password: string): Promise<unknown> {
  return api.post("/api/bootstrap/admin", { token, password });
}

export interface ArtifactView {
  name: string;
  label: string;
  size: number;
  sha256: string | null;
}

/** 执行面产物目录:公开产物名、大小与校验和,不含任何凭据 */
export interface ArtifactCatalog {
  publicUrl: string | null;
  assets: ArtifactView[];
}

export function bootstrapStatus(): Promise<BootstrapStatus> {
  return api.get("/api/bootstrap/status");
}

/** 匿名可读:控制台镜像的执行面产物(取件口为空时 assets 为空) */
export function fetchArtifacts(): Promise<ArtifactCatalog> {
  return api.get("/api/bootstrap/artifacts");
}

export function issueEnrollToken(): Promise<{ token: string; expiresAt: number }> {
  return api.post("/api/bootstrap/enroll-token", undefined, {
    idempotencyKey: newIdempotencyKey(),
  });
}

export function fetchDiscovery(): Promise<{
  machines: DiscoveryMachineView[];
  /** 控制台产物目录声明的最新采集器版本;未发布产物时为 null */
  latestCollectorVersion: string | null;
}> {
  return api.get("/api/bootstrap/discovery");
}

export function confirmAgents(
  machineId: string,
  agents: Array<{ project: string; displayName?: string; key?: string }>,
): Promise<{ agents: ConfirmedAgent[] }> {
  return api.post(
    "/api/bootstrap/agents",
    { machineId, agents },
    { idempotencyKey: newIdempotencyKey() },
  );
}

/** 请求 aw-node 刷新该机的飞书 bot 名;异步生效(下轮配置拉取后),返回 202 */
export function refreshBotNames(machineId: string): Promise<unknown> {
  return api.post(
    "/api/bootstrap/refresh-bot-names",
    { machineId },
    { idempotencyKey: newIdempotencyKey() },
  );
}

export function runPreflight(): Promise<PreflightResult> {
  return api.post("/api/bootstrap/preflight");
}

export function completeSetup(primaryAgentId: string): Promise<unknown> {
  return api.post(
    "/api/bootstrap/complete",
    { primaryAgentId },
    { idempotencyKey: newIdempotencyKey() },
  );
}
