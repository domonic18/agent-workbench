import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createAgentLifecycleService,
  type AgentLifecycleService,
} from "../../domain/identity/agent-lifecycle.js";
import { IdentityError } from "../../domain/identity/errors.js";
import {
  createIdempotencyService,
  type IdempotencyService,
} from "../../domain/security/idempotency.js";
import { IDENTITY_STATUSES } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { findAgentById } from "../../store/repositories/agent.js";
import { requireCsrf, requireIdempotencyKey, requireSession } from "../middleware/session.js";
import { sendError, toAgentDto, validationError } from "./identity.js";

/**
 * 幂等作用域按 Agent 分桶:同一个键若被误用于另一个 Agent,
 * 不应把后者的写操作变成前者的重放。
 */
const UPDATE_SCOPE = "agent.update";
const DELETE_SCOPE = "agent.delete";

const agentUpdateSchema = z
  .object({
    displayName: z.string().optional(),
    project: z.string().optional(),
    status: z.enum(IDENTITY_STATUSES).optional(),
    /** 宿主机器:null 表示解绑(只允许外部运行时) */
    machineId: z.string().nullable().optional(),
  })
  .strict();

const agentDeleteSchema = z
  .object({
    /** 主责 Agent 被删时必须给出接替者,否则 409 */
    reassignBootstrapPrimaryTo: z.string().optional(),
  })
  .strict();

export interface AgentLifecycleRoutesOptions {
  db: Db;
  now?: () => number;
  service?: AgentLifecycleService;
  idempotency?: IdempotencyService;
}

export function registerAgentLifecycleRoutes(
  app: FastifyInstance,
  options: AgentLifecycleRoutesOptions,
): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createAgentLifecycleService({ db, now });
  const idempotency = options.idempotency ?? createIdempotencyService({ db, now });
  const session = requireSession(db, now);
  const writeGuards = [session, requireCsrf(), requireIdempotencyKey()];

  app.patch("/api/agents/:id", { preHandler: writeGuards }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = agentUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    const key = request.headers["idempotency-key"] as string;
    const scope = `${UPDATE_SCOPE}:${id}`;
    const existingId = await idempotency.find(scope, key);
    if (existingId !== undefined) {
      const previous = await findAgentById(db, existingId);
      if (previous !== undefined) {
        return { agent: await toAgentDto(db, previous), replayed: true };
      }
    }
    try {
      const agent = await idempotency.run(scope, key, () => service.updateAgent(id, parsed.data));
      return { agent: await toAgentDto(db, agent), replayed: false };
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.get("/api/agents/:id/delete-impact", { preHandler: session }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const preview = await service.previewDeletion(id);
      return { preview };
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.delete("/api/agents/:id", { preHandler: writeGuards }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = agentDeleteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    const key = request.headers["idempotency-key"] as string;
    const scope = `${DELETE_SCOPE}:${id}`;
    const existingId = await idempotency.find(scope, key);
    if (existingId !== undefined) {
      return { id, replayed: true, bootstrapPrimaryReassignedTo: null };
    }
    try {
      const result = await idempotency.run(scope, key, () =>
        service.deleteAgent(id, {
          reassignBootstrapPrimaryTo: parsed.data.reassignBootstrapPrimaryTo,
        }),
      );
      return { ...result, replayed: false };
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });
}
