import type { FastifyInstance, FastifyReply } from "fastify";
import { A2aError } from "../../domain/a2a/errors.js";
import { createA2aService } from "../../domain/a2a/service.js";
import type { A2aService } from "../../domain/a2a/types.js";
import { A2A_PROTOCOL_VERSION } from "../../shared/constants.js";
import { validateEnvelope } from "../../shared/protocol.js";
import type { Db } from "../../store/database.js";
import type { AgentRecord } from "../../store/repositories/identity.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";
import { requireIdempotencyKey } from "../middleware/session.js";

export interface A2aRoutesOptions {
  db: Db;
  now?: () => number;
  service?: A2aService;
}

function sendError(reply: FastifyReply, error: A2aError): FastifyReply {
  return reply.code(error.status).send({
    error: {
      code: error.code,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    },
  });
}

function validationFailed(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(422).send({ error: { code: "VALIDATION_FAILED", message } });
}

/** `wait=25s` 或 `wait=250ms`;不带单位按秒,与 01 §5.1 的写法一致 */
function parseWaitMs(text: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return match[2] === "ms" ? value : value * 1000;
}

function optionalText(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return typeof value === "string" ? value : undefined;
}

export function registerA2aRoutes(app: FastifyInstance, options: A2aRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createA2aService({ db, now });
  const auth = requireAgentAuth(db);

  app.post(
    "/api/a2a/messages",
    { preHandler: [auth, requireIdempotencyKey()] },
    async (request, reply) => {
      const agent = request.agent as AgentRecord;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string") {
        return validationFailed(reply, "写操作必须携带 Idempotency-Key");
      }

      const rawThreadId = body.thread_id;
      if (rawThreadId !== undefined && (typeof rawThreadId !== "string" || rawThreadId === "")) {
        return validationFailed(reply, "thread_id 必须是非空字符串");
      }
      const rawReplyTo = body.reply_to;
      if (rawReplyTo !== undefined && (typeof rawReplyTo !== "string" || rawReplyTo === "")) {
        return validationFailed(reply, "reply_to 必须是非空字符串");
      }

      // from / v / round 一律服务端注入,客户端给值被覆盖
      const validation = validateEnvelope({
        ...body,
        v: A2A_PROTOCOL_VERSION,
        from: agent.id,
        round: 1,
      });
      if (!validation.ok) {
        return reply.code(422).send({
          error: {
            code: "VALIDATION_FAILED",
            message: "A2A 信封字段缺失或非法",
            detail: validation.issues,
          },
        });
      }
      const envelope = validation.envelope;

      try {
        const result = service.send({
          idempotencyKey: key,
          fromAgentId: agent.id,
          taskId: envelope.task_id,
          to: envelope.to,
          intent: envelope.intent,
          summary: envelope.summary,
          expect: envelope.expect,
          deadlineAt: envelope.deadline === undefined ? null : Date.parse(envelope.deadline),
          refs: envelope.refs ?? [],
          authTicketId: envelope.auth?.ticket_id ?? null,
          ...(rawThreadId === undefined ? {} : { threadId: rawThreadId }),
          ...(rawReplyTo === undefined ? {} : { replyToMsgId: rawReplyTo }),
        });
        return reply.code(201).send({
          msg_id: result.msgId,
          thread_id: result.threadId,
          round: result.round,
        });
      } catch (error) {
        if (error instanceof A2aError) {
          return sendError(reply, error);
        }
        throw error;
      }
    },
  );

  app.get("/api/a2a/inbox", { preHandler: auth }, async (request, reply) => {
    const agent = request.agent as AgentRecord;
    const query = request.query as Record<string, unknown>;

    const requestedAgent = query.agent_id;
    if (requestedAgent !== undefined) {
      if (typeof requestedAgent !== "string") {
        return validationFailed(reply, "agent_id 必须是字符串");
      }
      if (requestedAgent !== agent.id) {
        return reply
          .code(403)
          .send({ error: { code: "FORBIDDEN", message: "只能拉取自己的信箱" } });
      }
    }

    let cursor: string | undefined;
    if (query.cursor !== undefined) {
      if (typeof query.cursor !== "string") {
        return validationFailed(reply, "cursor 必须是字符串");
      }
      cursor = query.cursor;
    }

    let waitMs: number | undefined;
    if (query.wait !== undefined) {
      if (typeof query.wait !== "string") {
        return validationFailed(reply, "wait 必须形如 25s 或 250ms");
      }
      waitMs = parseWaitMs(query.wait);
      if (waitMs === undefined) {
        return validationFailed(reply, "wait 必须形如 25s 或 250ms");
      }
    }

    try {
      return await service.inbox(agent.id, {
        ...(cursor === undefined ? {} : { cursor }),
        ...(waitMs === undefined ? {} : { waitMs }),
      });
    } catch (error) {
      if (error instanceof A2aError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.post("/api/a2a/inbox/:msg_id/ack", { preHandler: auth }, async (request, reply) => {
    const agent = request.agent as AgentRecord;
    const { msg_id: msgId } = request.params as { msg_id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const taskId = optionalText(body, "task_id");
    if (body.task_id !== undefined && body.task_id !== null && taskId === undefined) {
      return validationFailed(reply, "task_id 必须是非空字符串");
    }
    try {
      service.ack(agent.id, msgId, taskId === undefined ? {} : { taskId });
      return { ok: true };
    } catch (error) {
      if (error instanceof A2aError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });
}
