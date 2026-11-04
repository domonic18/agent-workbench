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
}

export interface DiscoveryMachineView {
  machineId: string;
  hostname: string;
  status: string;
  receivedAt: number | null;
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

export function bootstrapStatus(): Promise<BootstrapStatus> {
  return api.get("/api/bootstrap/status");
}

export function issueEnrollToken(): Promise<{ token: string; expiresAt: number }> {
  return api.post("/api/bootstrap/enroll-token", undefined, {
    idempotencyKey: newIdempotencyKey(),
  });
}

export function fetchDiscovery(): Promise<{ machines: DiscoveryMachineView[] }> {
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
