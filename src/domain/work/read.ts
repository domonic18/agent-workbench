import type {
  WorkItemAttention,
  WorkItemStage,
  WorkItemStatus,
} from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { listRunsByWorkItem, type AgentRunRecord } from "../../store/repositories/run.js";
import { listTasksByWorkItem, type TaskRecord } from "../../store/repositories/task.js";
import { listInboxForWorkItem, type WorkerInboxRecord } from "../../store/repositories/work-inbox.js";
import {
  findWorkItemById,
  listWorkItemEvents,
  listWorkItems,
  type WorkItemEventRecord,
  type WorkItemRecord,
} from "../../store/repositories/work-item.js";
import {
  listThreadLinksByWorkItem,
  type WorkItemThreadLink,
} from "../../store/repositories/work-thread.js";
import { WorkError } from "./errors.js";

export interface WorkItemListQuery {
  project?: string;
  kind?: string;
  stage?: WorkItemStage;
  attention?: WorkItemAttention;
  status?: WorkItemStatus;
  limit: number;
  before?: { createdAt: number; id: string };
}

export interface WorkItemListResult {
  items: WorkItemRecord[];
  hasMore: boolean;
}

export interface WorkItemDetailResult {
  item: WorkItemRecord;
  tasks: TaskRecord[];
  runs: AgentRunRecord[];
  inbox: WorkerInboxRecord[];
  threadLinks: WorkItemThreadLink[];
}

export interface WorkItemEventsQuery {
  afterSeq: number;
  limit: number;
}

export interface WorkItemEventsResult {
  items: WorkItemEventRecord[];
  hasMore: boolean;
}

export interface WorkReadService {
  list(query: WorkItemListQuery): Promise<WorkItemListResult>;
  detail(workItemId: string): Promise<WorkItemDetailResult>;
  events(workItemId: string, query: WorkItemEventsQuery): Promise<WorkItemEventsResult>;
}

export interface WorkReadServiceDeps {
  db: Db;
}

export function createWorkReadService(deps: WorkReadServiceDeps): WorkReadService {
  const { db } = deps;

  async function requireItem(workItemId: string): Promise<WorkItemRecord> {
    const item = await findWorkItemById(db, workItemId);
    if (item === undefined) {
      throw new WorkError("NOT_FOUND", `工作事项 ${workItemId} 不存在`);
    }
    return item;
  }

  return {
    async list(query) {
      // 多取一行判断是否还有下一页,与任务列表一致
      const rows = await listWorkItems(db, { ...query, limit: query.limit + 1 });
      const hasMore = rows.length > query.limit;
      return { items: hasMore ? rows.slice(0, query.limit) : rows, hasMore };
    },

    async detail(workItemId) {
      const item = await requireItem(workItemId);
      const [tasks, runs, inbox, threadLinks] = await Promise.all([
        listTasksByWorkItem(db, workItemId),
        listRunsByWorkItem(db, workItemId),
        listInboxForWorkItem(db, workItemId),
        listThreadLinksByWorkItem(db, workItemId),
      ]);
      return { item, tasks, runs, inbox, threadLinks };
    },

    async events(workItemId, query) {
      await requireItem(workItemId);
      const rows = await listWorkItemEvents(db, workItemId, {
        afterSeq: query.afterSeq,
        limit: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      return { items: hasMore ? rows.slice(0, query.limit) : rows, hasMore };
    },
  };
}
