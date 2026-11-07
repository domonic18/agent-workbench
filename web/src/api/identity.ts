import { api, newIdempotencyKey } from "./client.js";
import type { AgentRuntime } from "./types.js";

export type IdentityStatus = "active" | "disabled";

export interface AgentSummary {
  id: string;
  machineId: string | null;
  runtime: AgentRuntime;
  project: string;
  displayName: string;
  feishuAppId: string | null;
  /** Agent 自报的飞书 bot 名称;为空表示尚未回写,显示时回退 displayName */
  feishuBotName: string | null;
  status: IdentityStatus;
  allowedTargets: string[];
  createdAt: number;
  updatedAt: number;
  /** 稳定 key:机器无关 Agent 的路由标识,机器绑定 Agent 为 null */
  key: string | null;
  usageLimit: AgentUsageLimit | null;
}

export interface AgentUsageLimit {
  dailyTokenLimit: number;
  warnPercent: number;
  hardStop: boolean;
  isActive: boolean;
  updatedAt: number;
}

/** 名册视图:身份档案 + 用量与在办聚合,供控制台 Agent 管理表格 */
export interface AgentRosterSummary extends AgentSummary {
  machineHostname: string | null;
  /** 机器展示名:控制台可改,空表示与 machineHostname 相同 */
  machineDisplayName: string | null;
  totalRuns: number;
  totalTokens: number;
  openTasks: number;
  lastRunAt: number | null;
}

/** 删除影响的三组计数 */
export interface AgentDeleteImpact {
  destroyed: {
    workerInbox: number;
    a2aThread: number;
    a2aMessage: number;
    a2aDeadLetter: number;
    outboxPull: number;
    agentRun: number;
    timelineEvent: number;
    tokenUsage: number;
    usageLimit: number;
  };
  detached: {
    workTrigger: number;
    knowledgeEntry: number;
  };
  retained: {
    task: number;
    toolCallLog: number;
    workItem: number;
  };
}

export interface AgentDeletionPreview {
  agent: {
    id: string;
    displayName: string;
    project: string;
    machineId: string | null;
    status: IdentityStatus;
  };
  impact: AgentDeleteImpact;
  /** 该 Agent 是默认 bug_fix 路由的主责:删除会被拦,须先指定接替者 */
  bootstrapPrimary: boolean;
  bootstrapPrimaryAgentId: string | null;
}

export interface MachineSummary {
  id: string;
  hostname: string;
  /** 展示名:控制台可改,默认等于 hostname */
  displayName: string;
  os: string;
  collectorVersion: string;
  lastSeenAt: number | null;
  status: IdentityStatus;
  createdAt: number;
}

export interface CreateAgentInput {
  /** 宿主机器:claude_code 必填;外部运行时可选(留空表示不绑定) */
  machineId?: string;
  runtime?: AgentRuntime;
  project: string;
  displayName: string;
  feishuAppId?: string;
  allowedTargets?: string[];
  /** 路由 key:只有外部运行时可显式给出 */
  key?: string;
}

export interface AgentSecret {
  agent: AgentSummary;
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

export function fetchAgents(): Promise<AgentRosterSummary[]> {
  return listAll<AgentRosterSummary>("/api/agents");
}

export function createAgent(input: CreateAgentInput): Promise<AgentSecret> {
  return api.post<AgentSecret>("/api/agents", input, {
    idempotencyKey: newIdempotencyKey(),
  });
}

/** 改机器展示名:hostname 是 enroll 去重键,不受影响 */
export function updateMachine(
  id: string,
  input: { displayName: string },
): Promise<{ machine: MachineSummary; replayed: boolean }> {
  return api.patch<{ machine: MachineSummary; replayed: boolean }>(
    `/api/machines/${encodeURIComponent(id)}`,
    input,
    { idempotencyKey: newIdempotencyKey() },
  );
}

export function rotateAgentKey(id: string): Promise<{ secret: string }> {
  return api.post<{ secret: string }>(
    `/api/agents/${encodeURIComponent(id)}/rotate`,
    undefined,
    { idempotencyKey: newIdempotencyKey() },
  );
}

/** 一次性接入令牌:Agent 拿它自助兑换密钥;明文只在这里出现一次 */
export interface AgentEnrollToken {
  token: string;
  expiresAt: number;
  agentId: string;
}

export function issueAgentEnrollToken(id: string): Promise<AgentEnrollToken> {
  return api.post<AgentEnrollToken>(
    `/api/agents/${encodeURIComponent(id)}/enroll-token`,
    undefined,
    { idempotencyKey: newIdempotencyKey() },
  );
}

/** 委派白名单只走控制台会话;保存即对下一次 a2a.send 判定生效 */
export function setAgentTargets(
  id: string,
  targets: string[],
): Promise<{ agent: AgentSummary }> {
  return api.put<{ agent: AgentSummary }>(
    `/api/agents/${encodeURIComponent(id)}/targets`,
    { targets },
    { idempotencyKey: newIdempotencyKey() },
  );
}

export interface AgentUsageLimitInput {
  dailyTokenLimit: number;
  warnPercent?: number;
  hardStop?: boolean;
  isActive?: boolean;
}

/** 用量上限:达到日额度后的行为由 hardStop 决定(停摆或只告警) */
export function setAgentUsageLimit(
  id: string,
  input: AgentUsageLimitInput,
): Promise<{ agent: AgentSummary }> {
  return api.put<{ agent: AgentSummary }>(
    `/api/agents/${encodeURIComponent(id)}/usage-limit`,
    input,
    { idempotencyKey: newIdempotencyKey() },
  );
}

export interface UpdateAgentInput {
  displayName?: string;
  project?: string;
  status?: IdentityStatus;
  /** 宿主机器:null 表示解绑(只允许外部运行时) */
  machineId?: string | null;
}

/** 改档案:改名 / 改项目 / 启停 */
export function updateAgent(
  id: string,
  input: UpdateAgentInput,
): Promise<{ agent: AgentSummary; replayed: boolean }> {
  return api.patch<{ agent: AgentSummary; replayed: boolean }>(
    `/api/agents/${encodeURIComponent(id)}`,
    input,
    { idempotencyKey: newIdempotencyKey() },
  );
}

/** 对话流事件:kind 与 payload 由采集侧定义 */
export interface AgentTimelineEntry {
  id: string;
  runId: string;
  runProject: string;
  runMachine: string;
  kind: string;
  occurredAt: number;
  payload: Record<string, unknown>;
}

export interface AgentTimelinePage {
  items: AgentTimelineEntry[];
  /** 更早一页的游标；没有更多时为 null */
  nextCursor: string | null;
}

/** 拉取 Agent 的对话流：时间正序的一页，cursor 指向更早的记录 */
export function fetchAgentTimeline(
  id: string,
  query: { limit?: number; cursor?: string } = {},
): Promise<AgentTimelinePage> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.cursor !== undefined) {
    params.set("cursor", query.cursor);
  }
  const suffix = params.toString();
  return api.get<AgentTimelinePage>(
    `/api/agents/${encodeURIComponent(id)}/timeline${suffix === "" ? "" : `?${suffix}`}`,
  );
}

/** 删除前的三级影响清单 */
export function fetchAgentDeleteImpact(
  id: string,
): Promise<{ preview: AgentDeletionPreview }> {
  return api.get<{ preview: AgentDeletionPreview }>(
    `/api/agents/${encodeURIComponent(id)}/delete-impact`,
  );
}

/**
 * 硬删除 Agent 并级联清理关联行。
 * 主责 Agent 须给接替者,否则服务端 409。
 */
export function deleteAgent(
  id: string,
  options: { reassignBootstrapPrimaryTo?: string } = {},
): Promise<{ id: string; replayed: boolean; bootstrapPrimaryReassignedTo: string | null }> {
  const body =
    options.reassignBootstrapPrimaryTo === undefined
      ? undefined
      : { reassignBootstrapPrimaryTo: options.reassignBootstrapPrimaryTo };
  return api.delete<{
    id: string;
    replayed: boolean;
    bootstrapPrimaryReassignedTo: string | null;
  }>(`/api/agents/${encodeURIComponent(id)}`, body, {
    idempotencyKey: newIdempotencyKey(),
  });
}
