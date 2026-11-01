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
  list(query: TaskListQuery): TaskListResult;
  detail(taskId: string): TaskDetailResult;
  events(taskId: string, query: TaskEventsQuery): TaskEventsResult;
}

export interface TaskReadServiceDeps {
  db: Db;
}

export function createTaskReadService(deps: TaskReadServiceDeps): TaskReadService {
  const { db } = deps;

  function requireTask(taskId: string): TaskRecord {
    const task = findTaskById(db, taskId);
    if (task === undefined) {
      throw new TaskError("NOT_FOUND", `任务 ${taskId} 不存在`);
    }
    return task;
  }

  return {
    list(query) {
      // 多取一行判断是否还有下一页,避免为翻页额外 COUNT
      const rows = listTasks(db, { ...query, limit: query.limit + 1 });
      const hasMore = rows.length > query.limit;
      return { items: hasMore ? rows.slice(0, query.limit) : rows, hasMore };
    },

    detail(taskId) {
      // 与总览同理:先取水位再读投影
      const revision = currentRevision(db, taskScopeName(taskId));
      const task = requireTask(taskId);
      return {
        task,
        capabilities: listCapabilitySummariesByTask(db, taskId),
        tokens: summarizeTaskTokens(db, taskId),
        revision,
      };
    },

    events(taskId, query) {
      const revision = currentRevision(db, taskScopeName(taskId));
      requireTask(taskId);
      const rows = listTaskEvents(db, taskId, query.afterSeq, query.limit + 1);
      const hasMore = rows.length > query.limit;
      return { revision, items: hasMore ? rows.slice(0, query.limit) : rows, hasMore };
    },
  };
}
