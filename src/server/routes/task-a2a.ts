import type { FastifyInstance } from "fastify";
import { createA2aThreadReadService, type A2aThreadReadService } from "../../domain/a2a/threads.js";
import { createRevisionService } from "../../domain/revision/service.js";
import { TaskError } from "../../domain/task/errors.js";
import { taskScopeName } from "../../shared/scopes.js";
import { parseJsonStringArray } from "../../store/json.js";
import type { Db } from "../../store/database.js";
import type { A2aThreadMessageRecord } from "../../store/repositories/a2a.js";
import { requireSession } from "../middleware/session.js";
import { sendError } from "./task-dto.js";

export interface TaskA2aRoutesOptions {
  db: Db;
  now?: () => number;
  service?: A2aThreadReadService;
}

interface DeliveryDto {
  status: string;
  attempts: number;
  last_error: string | null;
}

function toDeliveryDto(row: A2aThreadMessageRecord): DeliveryDto | null {
  if (row.deliveryStatus === null) {
    return null;
  }
  return {
    status: row.deliveryStatus,
    attempts: row.deliveryAttempts ?? 0,
    last_error: row.deliveryError,
  };
}

function toMessageDto(row: A2aThreadMessageRecord) {
  return {
    msg_id: row.id,
    thread_id: row.threadId,
    task_id: row.taskId,
    round: row.round,
    reply_to: row.replyToMsgId,
    from: row.fromAgent,
    to: row.toAgent,
    intent: row.intent,
    summary: row.summary,
    expect: row.expect,
    deadline_at: row.deadlineAt,
    refs: parseJsonStringArray(row.refsJson),
    // 只给凭证标识,不返回证书内容
    auth_ticket: row.authTicket,
    ack_at: row.ackAt,
    created_at: row.createdAt,
    delivery: toDeliveryDto(row),
  };
}

export function registerTaskA2aRoutes(
  app: FastifyInstance,
  options: TaskA2aRoutesOptions,
): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createA2aThreadReadService({ db, now });
  const revisions = createRevisionService({ db });
  const session = requireSession(db, now);

  app.get("/api/tasks/:id/a2a", { preHandler: session }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // 先取水位再读投影,与任务详情 / 事件流一致
    const revision = revisions.snapshot([taskScopeName(id)])[0]?.revision ?? 0;
    try {
      const threads = service.byTask(id);
      return {
        revision,
        threads: threads.map((thread) => ({
          thread_id: thread.id,
          initiator_task_id: thread.initiatorTaskId,
          initiator_agent: thread.initiatorAgent,
          responder_agent: thread.responderAgent,
          created_at: thread.createdAt,
          status: thread.status,
          messages: thread.messages.map(toMessageDto),
        })),
      };
    } catch (error) {
      if (error instanceof TaskError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });
}
