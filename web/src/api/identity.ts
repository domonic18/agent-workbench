import { api, newIdempotencyKey } from "./client.js";

export type IdentityStatus = "active" | "disabled";

export interface AgentSummary {
  id: string;
  machineId: string;
  project: string;
  displayName: string;
  feishuAppId: string | null;
  status: IdentityStatus;
  allowedTargets: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MachineSummary {
  id: string;
  hostname: string;
  os: string;
  collectorVersion: string;
  lastSeenAt: number | null;
  status: IdentityStatus;
  createdAt: number;
}

export interface CreateAgentInput {
  machineId: string;
  project: string;
  displayName: string;
  feishuAppId?: string;
  allowedTargets?: string[];
}

export interface CreateMachineInput {
  id: string;
  hostname: string;
  os: string;
  collectorVersion: string;
}

export interface AgentSecret {
  agent: AgentSummary;
  secret: string;
}

export interface MachineSecret {
  machine: MachineSummary;
  secret: string;
}

interface ListResponse<T> {
  items: T[];
  nextCursor: string | null;
}

async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor !== null) {
      params.set("cursor", cursor);
    }
    const page = await api.get<ListResponse<T>>(`${path}?${params.toString()}`);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

export function fetchMachines(): Promise<MachineSummary[]> {
  return listAll<MachineSummary>("/api/machines");
}

export function fetchAgents(): Promise<AgentSummary[]> {
  return listAll<AgentSummary>("/api/agents");
}

export function createAgent(input: CreateAgentInput): Promise<AgentSecret> {
  return api.post<AgentSecret>("/api/agents", input, {
    idempotencyKey: newIdempotencyKey(),
  });
}

export function createMachine(input: CreateMachineInput): Promise<MachineSecret> {
  return api.post<MachineSecret>("/api/machines", input, {
    idempotencyKey: newIdempotencyKey(),
  });
}

export function rotateAgentKey(id: string): Promise<{ secret: string }> {
  return api.post<{ secret: string }>(
    `/api/agents/${encodeURIComponent(id)}/rotate`,
    undefined,
    { idempotencyKey: newIdempotencyKey() },
  );
}
