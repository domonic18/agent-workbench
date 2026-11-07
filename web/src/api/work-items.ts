import { api } from "./client.js";
import {
  WORKER_INBOX_KINDS,
  WORK_ITEM_ATTENTIONS,
  WORK_ITEM_STAGES,
  WORK_ITEM_STATUSES,
} from "@shared/constants.js";
import type {
  WorkItemAttention,
  WorkItemStage,
  WorkItemStatus,
  WorkerInboxKind,
} from "@shared/constants.js";

export { WORKER_INBOX_KINDS, WORK_ITEM_ATTENTIONS, WORK_ITEM_STAGES, WORK_ITEM_STATUSES };
export type { WorkItemAttention, WorkItemStage, WorkItemStatus, WorkerInboxKind };

/** 工作事项列表条目:只带投影列,Mandate 与关联数据走详情 */
export interface WorkItemListItem {
  id: string;
  project: string;
  kind: string;
  title: string;
  status: WorkItemStatus;
  stage: WorkItemStage;
  attention: WorkItemAttention;
  nextAction: string | null;
  latestSummary: string | null;
  lastProgressAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkItemDetail extends WorkItemListItem {
  parentWorkItemId: string | null;
  expectedResult: string;
  scope: unknown;
  originTriggerId: string | null;
  authorization: { kind: string; ref: string | null };
  policyVersion: string;
  /** 进展版本:业务侧的事实推进次数,与 SSE 的作用域 revision 不是一回事 */
  progressRevision: number;
  output: string | null;
  validation: unknown;
  acceptanceRef: string | null;
  endedAt: number | null;
}

export interface WorkItemTaskLink {
  id: string;
  title: string;
  assignee: string;
  status: string;
  origin: string;
  output: string | null;
  createdAt: number;
}

export interface WorkItemRunLink {
  id: string;
  agentId: string;
  status: string;
  startedAt: number | null;
  endedAt: number | null;
}

export interface WorkItemInboxLink {
  id: string;
  kind: WorkerInboxKind;
  targetAgentId: string;
  status: string;
  taskId: string | null;
  leaseUntil: number | null;
  reason: string | null;
  createdAt: number;
}

export interface WorkItemThreadLink {
  subscriptionId: string;
  threadId: string;
  source: string;
  externalKind: string;
  externalKey: string;
  mode: string;
  revokedAt: number | null;
}

export interface WorkItemDetailResponse {
  workItem: WorkItemDetail;
  tasks: WorkItemTaskLink[];
  runs: WorkItemRunLink[];
  inbox: WorkItemInboxLink[];
  threads: WorkItemThreadLink[];
}

export interface WorkItemEvent {
  id: string;
  seq: number;
  kind: string;
  triggerId: string | null;
  evidenceRefs: unknown;
  payload: unknown;
  occurredAt: number;
}

export interface WorkItemListResponse {
  items: WorkItemListItem[];
  /** 键集游标 `<createdAt>:<id>`;没有下一页时为 null */
  nextCursor: string | null;
}

export interface WorkItemEventsResponse {
  items: WorkItemEvent[];
  /** 下一个 seq 游标;没有更多时为 null */
  nextCursor: number | null;
}

export interface WorkItemListQuery {
  attention?: WorkItemAttention | undefined;
  status?: WorkItemStatus | undefined;
  stage?: WorkItemStage | undefined;
  project?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

/**
 * 总览区块的筛选:URL 键是 `wi`(工作事项),不是接口参数名 `attention`,
 * 两者同名不同义,别把查询串直接透给接口。
 */
export function readWorkItemFilter(params: URLSearchParams): WorkItemAttention | null {
  const raw = params.get("wi");
  return raw !== null && (WORK_ITEM_ATTENTIONS as readonly string[]).includes(raw)
    ? (raw as WorkItemAttention)
    : null;
}

export function fetchWorkItems(query: WorkItemListQuery = {}): Promise<WorkItemListResponse> {
  const params = new URLSearchParams();
  if (query.attention !== undefined) {
    params.set("attention", query.attention);
  }
  if (query.status !== undefined) {
    params.set("status", query.status);
  }
  if (query.stage !== undefined) {
    params.set("stage", query.stage);
  }
  if (query.project !== undefined) {
    params.set("project", query.project);
  }
  if (query.cursor !== undefined) {
    params.set("cursor", query.cursor);
  }
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  const suffix = params.toString();
  return api.get<WorkItemListResponse>(
    `/api/work-items${suffix === "" ? "" : `?${suffix}`}`,
  );
}

export function fetchWorkItem(id: string): Promise<WorkItemDetailResponse> {
  return api.get<WorkItemDetailResponse>(`/api/work-items/${encodeURIComponent(id)}`);
}

/**
 * 拉取工作事项事件。
 * 服务端按 `seq > cursor` 升序返回,cursor=0 给出最早的一批,每页往后推进。
 */
export function fetchWorkItemEvents(
  id: string,
  cursor = 0,
  limit = 200,
): Promise<WorkItemEventsResponse> {
  const params = new URLSearchParams({ cursor: String(cursor), limit: String(limit) });
  return api.get<WorkItemEventsResponse>(
    `/api/work-items/${encodeURIComponent(id)}/events?${params.toString()}`,
  );
}
