import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { TaskError } from "../../domain/task/errors.js";
import { createTaskService, type TaskService } from "../../domain/task/service.js";
import type { CollabNotify } from "../../shared/collab.js";
import { TASK_STAGES, TASK_STATUSES } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import type { AgentRecord } from "../../store/repositories/identity.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";
import { requireIdempotencyKey } from "../middleware/session.js";
import { buildCompletionNotify } from "../notification/collab.js";
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
  /** 协作通知群;留空则响应不带 notify,proxy 不发群消息 */
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
        let notify: CollabNotify | undefined;
        if (parsed.data.status === "done" && options.collabChatId !== undefined) {
          const notice = service.completionNotice(task.id);
          if (notice !== null) {
            notify = buildCompletionNotify(notice, options.collabChatId);
          }
        }
        return {
          task: toTaskDto(task),
          ...(notify === undefined ? {} : { notify }),
        };
      } catch (error) {
        if (error instanceof TaskError) {
          return sendError(reply, error);
        }
        throw error;
      }
    },
  );
}
