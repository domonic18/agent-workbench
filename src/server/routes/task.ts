import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { TaskError } from "../../domain/task/errors.js";
import { createTaskService, type TaskService } from "../../domain/task/service.js";
import { TASK_STAGES, TASK_STATUSES } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import type { AgentRecord } from "../../store/repositories/agent.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";
import { requireIdempotencyKey } from "../middleware/session.js";
import { announceTaskUpdate } from "../../domain/collab/announce.js";
import { sendError, toTaskDto } from "./task-dto.js";

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
  /** 协作播报群;留空则不入队播报 */
  collabChatId?: string;
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
        const task = await service.create({ ...parsed.data, assignee: agent.id });
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
        const { task, autoClosed } = await service.update({
          ...parsed.data,
          taskId: id,
          assignee: agent.id,
        });
        // ③ 完成播报 + ④ 验收播报:控制台经发件箱直发,不返回 notify 给 proxy(2026-11-02 裁决)
        await announceTaskUpdate(
          {
            db,
            ...(options.collabChatId === undefined ? {} : { chatId: options.collabChatId }),
            ...(options.now === undefined ? {} : { now: options.now }),
          },
          service,
          task,
          autoClosed,
        );
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
