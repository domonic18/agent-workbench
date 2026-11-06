import type { FastifyInstance } from "fastify";
import { TaskError } from "../../domain/task/errors.js";
import { createTaskReadService, type TaskReadService } from "../../domain/task/read.js";
import { LIST_LIMITS, TASK_STATUSES, type TaskStatus } from "../../shared/constants.js";
import { parseJsonObject } from "../../shared/json.js";
import type { Db } from "../../store/database.js";
import { resolveAgentLabels } from "../../store/repositories/agent-lifecycle.js";
import type { CapabilitySummary } from "../../store/repositories/capability.js";
import type { TaskEventRecord, TaskRecord } from "../../store/repositories/task.js";
import { requireSession } from "../middleware/session.js";
import { invalid } from "./http.js";
import { parseKeysetCursor, parseLimit, parseSeq } from "./paging.js";
import { sendError, toTaskDto } from "./task-dto.js";

export interface TaskReadRoutesOptions {
  db: Db;
  now?: () => number;
  read?: TaskReadService;
}

interface CapabilityDto {
  id: string;
  target: string;
  action: string;
  scope: unknown;
  status: string;
  expires_at: number | null;
  created_at: number;
}

function toCapabilityDto(row: CapabilitySummary): CapabilityDto {
  return {
    id: row.id,
    target: row.target,
    action: row.action,
    scope: parseJsonObject(row.scopeJson),
    status: row.status,
    expires_at: row.expiresAt,
    created_at: row.createdAt,
  };
}

interface TaskEventDto {
  id: string;
  seq: number;
  kind: string;
  payload: unknown;
  occurred_at: number;
}

function toTaskEventDto(row: TaskEventRecord): TaskEventDto {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    payload: parseJsonObject(row.payloadJson),
    occurred_at: row.occurredAt,
  };
}

/** 一页任务里出现过的承接方与下发人去重,供墓碑解析 */
function agentIdsOf(rows: readonly TaskRecord[]): string[] {
  return [...new Set(rows.flatMap((row) => [row.assignee, row.assigner]))];
}

export function registerTaskReadRoutes(
  app: FastifyInstance,
  options: TaskReadRoutesOptions,
): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const read = options.read ?? createTaskReadService({ db });
  const session = requireSession(db, now);

  app.get("/api/tasks", { preHandler: session }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;

    let status: TaskStatus | undefined;
    if (query.status !== undefined) {
      if (
        typeof query.status !== "string" ||
        !TASK_STATUSES.includes(query.status as TaskStatus)
      ) {
        return invalid(reply, `status 只接受 ${TASK_STATUSES.join(" / ")}`);
      }
      status = query.status as TaskStatus;
    }

    let project: string | undefined;
    if (query.project !== undefined) {
      if (typeof query.project !== "string" || query.project.trim() === "") {
        return invalid(reply, "project 必须是非空字符串");
      }
      project = query.project;
    }

    let assignee: string | undefined;
    if (query.assignee !== undefined) {
      if (typeof query.assignee !== "string" || query.assignee.trim() === "") {
        return invalid(reply, "assignee 必须是非空字符串");
      }
      assignee = query.assignee;
    }

    const limit = parseLimit(query.limit);
    if (limit === undefined) {
      return invalid(reply, `limit 必须为 1~${LIST_LIMITS.max} 的整数`);
    }

    let before: { createdAt: number; id: string } | undefined;
    if (query.cursor !== undefined) {
      const parsed =
        typeof query.cursor === "string" ? parseKeysetCursor(query.cursor) : undefined;
      before = parsed === undefined ? undefined : { createdAt: parsed.sort, id: parsed.id };
      if (before === undefined) {
        return invalid(reply, "cursor 格式应为 <createdAt>:<id>");
      }
    }

    const result = await read.list({
      limit,
      ...(status === undefined ? {} : { status }),
      ...(project === undefined ? {} : { project }),
      ...(assignee === undefined ? {} : { assignee }),
      ...(before === undefined ? {} : { before }),
    });
    const last = result.items.at(-1);
    // 承接方可能已被硬删除:查墓碑把裸 id 换成「已删除 Agent X」
    const labels = await resolveAgentLabels(db, agentIdsOf(result.items));
    return {
      items: result.items.map((row) => toTaskDto(row, labels)),
      nextCursor:
        result.hasMore && last !== undefined ? `${last.createdAt}:${last.id}` : null,
    };
  });

  app.get("/api/tasks/:id", { preHandler: session }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await read.detail(id);
      const labels = await resolveAgentLabels(db, agentIdsOf([result.task]));
      return {
        task: toTaskDto(result.task, labels),
        capabilities: result.capabilities.map(toCapabilityDto),
        tokens: result.tokens,
        revision: result.revision,
      };
    } catch (error) {
      if (error instanceof TaskError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.get("/api/tasks/:id/events", { preHandler: session }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;

    const afterSeq = parseSeq(query.cursor);
    if (afterSeq === undefined) {
      return invalid(reply, "cursor 必须是非负整数 seq");
    }
    const limit = parseLimit(query.limit);
    if (limit === undefined) {
      return invalid(reply, `limit 必须为 1~${LIST_LIMITS.max} 的整数`);
    }

    try {
      const result = await read.events(id, { afterSeq, limit });
      const last = result.items.at(-1);
      return {
        revision: result.revision,
        items: result.items.map(toTaskEventDto),
        nextCursor: result.hasMore && last !== undefined ? last.seq : null,
      };
    } catch (error) {
      if (error instanceof TaskError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });
}
