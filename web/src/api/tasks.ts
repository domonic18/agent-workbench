import { api } from "./client.js";
import {
  A2A_INTENTS,
  A2A_THREAD_STATUSES,
  CAPABILITY_STATUSES,
  OUTBOX_STATUSES,
  TASK_EVENT_KINDS,
  TASK_ORIGINS,
  TASK_STAGES,
  TASK_STATUSES,
} from "@shared/constants.js";
import type {
  A2AIntent as A2aIntent,
  A2aThreadStatus,
  CapabilityStatus,
  OutboxStatus,
  TaskEventKind,
  TaskOrigin,
  TaskStage,
  TaskStatus,
} from "@shared/constants.js";

export {
  A2A_INTENTS,
  A2A_THREAD_STATUSES,
  CAPABILITY_STATUSES,
  TASK_EVENT_KINDS,
  TASK_ORIGINS,
  TASK_STAGES,
  TASK_STATUSES,
};
export type {
  A2aIntent,
  A2aThreadStatus,
  CapabilityStatus,
  TaskEventKind,
  TaskOrigin,
  TaskStage,
  TaskStatus,
};

/** 发件箱投递状态:与控制台 OUTBOX_STATUSES 对齐 */
export const DELIVERY_STATUSES = OUTBOX_STATUSES;
export type DeliveryStatus = OutboxStatus;

export interface TaskDto {
  id: string;
  title: string;
  assigner: string;
  assignee: string;
  /** 展示用名:Agent 已被硬删除时显示「已删除 Agent X」,否则与原始 id 相同 */
  assigner_label: string;
  assignee_label: string;
  project: string;
  parent_task_id: string | null;
  /** 所属工作事项(业务事项);null 表示该任务不挂在任何事项下 */
  work_item_id: string | null;
  round: number;
  rework_count: number;
  stage: TaskStage;
  status: TaskStatus;
  origin: TaskOrigin;
  deadline_at: number | null;
  output: string | null;
  started_at: number | null;
  ended_at: number | null;
  total_tokens: number;
  created_at: number;
  updated_at: number;
}

export interface TaskFilters {
  status: TaskStatus | null;
  project: string | null;
  assignee: string | null;
}

export interface TaskListQuery {
  status?: TaskStatus;
  project?: string;
  assignee?: string;
  cursor?: string;
  limit?: number;
}

export interface TaskListResponse {
  items: TaskDto[];
  nextCursor: string | null;
}

export interface TaskCapability {
  id: string;
  target: string;
  action: string;
  scope: unknown;
  status: CapabilityStatus;
  expires_at: number | null;
  created_at: number;
}

export interface TaskTokenSummary {
  total: number;
  entries: number;
}

export interface TaskDetailResponse {
  task: TaskDto;
  capabilities: TaskCapability[];
  tokens: TaskTokenSummary;
  revision: number;
}

export interface TaskEventDto {
  id: string;
  seq: number;
  kind: TaskEventKind;
  payload: Record<string, unknown>;
  occurred_at: number;
}

export interface TaskEventsResponse {
  revision: number;
  items: TaskEventDto[];
  nextCursor: number | null;
}

export interface A2aDelivery {
  status: DeliveryStatus;
  attempts: number;
  last_error: string | null;
}

export interface A2aMessage {
  msg_id: string;
  thread_id: string;
  task_id: string;
  round: number;
  reply_to: string | null;
  from: string;
  to: string;
  intent: A2aIntent;
  summary: string;
  expect: string;
  deadline_at: number | null;
  refs: string[];
  auth_ticket: string | null;
  ack_at: number | null;
  created_at: number;
  delivery: A2aDelivery | null;
}

export interface A2aThread {
  thread_id: string;
  initiator_task_id: string;
  initiator_agent: string;
  responder_agent: string;
  created_at: number;
  status: A2aThreadStatus;
  messages: A2aMessage[];
}

export interface TaskA2aResponse {
  revision: number;
  threads: A2aThread[];
}

function trimOrNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** 状态只接受服务端枚举,非法值按「未筛选」处理,避免坏 URL 直接 422 */
export function readTaskFilters(params: URLSearchParams): TaskFilters {
  const rawStatus = params.get("status");
  const status =
    rawStatus !== null && (TASK_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as TaskStatus)
      : null;
  return {
    status,
    project: trimOrNull(params.get("project")),
    assignee: trimOrNull(params.get("assignee")),
  };
}

export function fetchTasks(query: TaskListQuery = {}): Promise<TaskListResponse> {
  const params = new URLSearchParams();
  if (query.status !== undefined) {
    params.set("status", query.status);
  }
  if (query.project !== undefined) {
    params.set("project", query.project);
  }
  if (query.assignee !== undefined) {
    params.set("assignee", query.assignee);
  }
  if (query.cursor !== undefined) {
    params.set("cursor", query.cursor);
  }
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  const suffix = params.toString();
  return api.get<TaskListResponse>(`/api/tasks${suffix === "" ? "" : `?${suffix}`}`);
}

export function fetchTask(id: string): Promise<TaskDetailResponse> {
  return api.get<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(id)}`);
}

export function fetchTaskEvents(
  id: string,
  cursor = 0,
  limit = 200,
): Promise<TaskEventsResponse> {
  const params = new URLSearchParams({ cursor: String(cursor), limit: String(limit) });
  return api.get<TaskEventsResponse>(
    `/api/tasks/${encodeURIComponent(id)}/events?${params.toString()}`,
  );
}

export function fetchTaskA2a(id: string): Promise<TaskA2aResponse> {
  return api.get<TaskA2aResponse>(`/api/tasks/${encodeURIComponent(id)}/a2a`);
}
