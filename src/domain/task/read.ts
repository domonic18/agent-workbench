import type { TaskStatus } from "../../shared/constants.js";
import { taskScopeName } from "../../shared/scopes.js";
import type { Db } from "../../store/database.js";
import {
  listCapabilitySummariesByTask,
  type CapabilitySummary,
} from "../../store/repositories/capability.js";
import { currentRevision } from "../../store/repositories/revision.js";
import {
  findTaskById,
  listTaskEvents,
  listTasks,
  type TaskEventRecord,
  type TaskRecord,
} from "../../store/repositories/task.js";
import {
  summarizeTaskTokens,
  type TaskTokenSummary,
} from "../../store/repositories/token-usage.js";
import { TaskError } from "./errors.js";

export interface TaskListQuery {
  status?: TaskStatus;
  project?: string;
  assignee?: string;
  limit: number;
  before?: { createdAt: number; id: string };
}

export interface TaskListResult {
  items: TaskRecord[];
  hasMore: boolean;
}

export interface TaskDetailResult {
  task: TaskRecord;
  capabilities: CapabilitySummary[];
  tokens: TaskTokenSummary;
  revision: number;
}

export interface TaskEventsQuery {
  afterSeq: number;
  limit: number;
}

export interface TaskEventsResult {
  revision: number;
  items: TaskEventRecord[];
  hasMore: boolean;
}

export interface TaskReadService {
  list(query: TaskListQuery): Promise<TaskListResult>;
  detail(taskId: string): Promise<TaskDetailResult>;
  events(taskId: string, query: TaskEventsQuery): Promise<TaskEventsResult>;
}

export interface TaskReadServiceDeps {
  db: Db;
}

export function createTaskReadService(deps: TaskReadServiceDeps): TaskReadService {
  const { db } = deps;

  async function requireTask(taskId: string): Promise<TaskRecord> {
    const task = await findTaskById(db, taskId);
    if (task === undefined) {
      throw new TaskError("NOT_FOUND", `任务 ${taskId} 不存在`);
    }
    return task;
  }

  return {
    async list(query) {
      // 多取一行判断是否还有下一页,避免为翻页额外 COUNT
      const rows = await listTasks(db, { ...query, limit: query.limit + 1 });
      const hasMore = rows.length > query.limit;
      return { items: hasMore ? rows.slice(0, query.limit) : rows, hasMore };
    },

    async detail(taskId) {
      // 与总览同理:先取水位再读投影
      const revision = await currentRevision(db, taskScopeName(taskId));
      const task = await requireTask(taskId);
      return {
        task,
        capabilities: await listCapabilitySummariesByTask(db, taskId),
        tokens: await summarizeTaskTokens(db, taskId),
        revision,
      };
    },

    async events(taskId, query) {
      const revision = await currentRevision(db, taskScopeName(taskId));
      await requireTask(taskId);
      const rows = await listTaskEvents(db, taskId, query.afterSeq, query.limit + 1);
      const hasMore = rows.length > query.limit;
      return { revision, items: hasMore ? rows.slice(0, query.limit) : rows, hasMore };
    },
  };
}
