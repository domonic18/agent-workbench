import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { TaskError } from "../../domain/task/errors.js";
import { createTaskService, type TaskService } from "../../domain/task/service.js";
import { TASK_STAGES, TASK_STATUSES } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import type { TaskRecord } from "../../store/repositories/task.js";
import type { AgentRecord } from "../../store/repositories/identity.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";
import { requireIdempotencyKey } from "../middleware/session.js";

const createSchema = z.object({
  title: z.string(),
  assigner: z.string(),
  project: z.string(),
  deadlineAt: z.number().nullish(),
  output: z.string().nullish(),
  parentTaskId: z.string().nullish(),
});

const updateSchema = z.object({
  stage: z.enum(TASK_STAGES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  output: z.string().nullish(),
  deadlineAt: z.number().nullish(),
  reason: z.string().optional(),
});

export interface TaskRoutesOptions {
  db: Db;
  now?: () => number;
  service?: TaskService;
}

interface TaskDto {
  id: string;
  title: string;
  assigner: string;
  assignee: string;
  project: string;
  parent_task_id: string | null;
  round: number;
  rework_count: number;
  stage: string;
  status: string;
  origin: string;
  deadline_at: number | null;
  output: string | null;
  started_at: number | null;
  ended_at: number | null;
  total_tokens: number;
  created_at: number;
  updated_at: number;
}

function toTaskDto(row: TaskRecord): TaskDto {
  return {
    id: row.id,
    title: row.title,
    assigner: row.assigner,
    assignee: row.assignee,
    project: row.project,
    parent_task_id: row.parentTaskId,
    round: row.round,
    rework_count: row.reworkCount,
    stage: row.stage,
    status: row.status,
    origin: row.origin,
    deadline_at: row.deadlineAt,
    output: row.output,
    started_at: row.startedAt,
    ended_at: row.endedAt,
    total_tokens: row.totalTokens,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function sendError(reply: FastifyReply, error: TaskError): FastifyReply {
  return reply.code(error.status).send({
    error: {
      code: error.code,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    },
  });
}

function validationError(reply: FastifyReply, issues: z.ZodError): FastifyReply {
  return reply.code(422).send({
    error: {
      code: "VALIDATION_FAILED",
      message: "字段缺失或类型错误",
      detail: issues.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
  });
}

export function registerTaskRoutes(app: FastifyInstance, options: TaskRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createTaskService({ db, now });
  const auth = requireAgentAuth(db);

  app.post(
    "/api/tasks",
    { preHandler: [auth, requireIdempotencyKey()] },
    async (request, reply) => {
      const agent = request.agent as AgentRecord;
      const parsed = createSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return validationError(reply, parsed.error);
      }
      try {
        // assignee 恒取 Bearer 身份,请求体自述的 agent_id/assignee 一律忽略
        const task = service.create({ ...parsed.data, assignee: agent.id });
        return reply.code(201).send({ task: toTaskDto(task) });
      } catch (error) {
        if (error instanceof TaskError) {
          return sendError(reply, error);
        }
        throw error;
      }
    },
  );

  app.patch(
    "/api/tasks/:id",
    { preHandler: [auth, requireIdempotencyKey()] },
    async (request, reply) => {
      const agent = request.agent as AgentRecord;
      const { id } = request.params as { id: string };
      const parsed = updateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return validationError(reply, parsed.error);
      }
      try {
        const task = service.update({ ...parsed.data, taskId: id, assignee: agent.id });
        return { task: toTaskDto(task) };
      } catch (error) {
        if (error instanceof TaskError) {
          return sendError(reply, error);
        }
        throw error;
      }
    },
  );
}
