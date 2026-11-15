import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createGroupService, type GroupService } from "../../domain/group/service.js";
import { IdentityError } from "../../domain/identity/errors.js";
import type { Db } from "../../store/database.js";
import { requireCsrf, requireIdempotencyKey, requireSession } from "../middleware/session.js";
import { sendError, validationError } from "./identity.js";

const groupCreateSchema = z.object({
  name: z.string().min(1).max(64),
  memberIds: z.array(z.string()).max(200).optional(),
});

const groupUpdateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  memberIds: z.array(z.string()).max(200).optional(),
});

export interface AgentGroupRoutesOptions {
  db: Db;
  now?: () => number;
  service?: GroupService;
}

/**
 * 委派目标组的管理接口(仅控制台会话)。
 *
 * 组只回答「哪些 Agent 可以被某个 Agent 委派」;派工与能力签发不经过这里。
 */
export function registerAgentGroupRoutes(
  app: FastifyInstance,
  options: AgentGroupRoutesOptions,
): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createGroupService({ db, now });
  const session = requireSession(db, now);
  const writeGuards = [session, requireCsrf(), requireIdempotencyKey()];

  app.get("/api/agent-groups", { preHandler: session }, async () => {
    return { items: await service.list() };
  });

  app.post("/api/agent-groups", { preHandler: writeGuards }, async (request, reply) => {
    const parsed = groupCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    try {
      return { group: await service.create(parsed.data) };
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.put("/api/agent-groups/:id", { preHandler: writeGuards }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = groupUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    try {
      return { group: await service.update(id, parsed.data) };
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.delete("/api/agent-groups/:id", { preHandler: writeGuards }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await service.remove(id);
      return { removed: true };
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });
}
