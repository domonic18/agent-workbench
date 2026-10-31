import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { IdentityError } from "../../domain/identity/errors.js";
import { createIdentityService, type IdentityService } from "../../domain/identity/service.js";
import { LIST_LIMITS, type IdentityStatus } from "../../shared/constants.js";
import { formatKeysetCursor, parseKeysetCursor } from "../../shared/cursor.js";
import type { Db } from "../../store/database.js";
import { parseJsonStringArray } from "../../store/json.js";
import type { AgentRecord, MachineRecord } from "../../store/repositories/identity.js";
import { requireCsrf, requireIdempotencyKey, requireSession } from "../middleware/session.js";

const machineCreateSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  os: z.string(),
  collectorVersion: z.string(),
});

const agentCreateSchema = z.object({
  machineId: z.string(),
  project: z.string(),
  displayName: z.string(),
  feishuAppId: z.string().nullable().optional(),
  allowedTargets: z.array(z.string()).optional(),
});

export interface IdentityRoutesOptions {
  db: Db;
  now?: () => number;
  service?: IdentityService;
}

interface MachineDto {
  id: string;
  hostname: string;
  os: string;
  collectorVersion: string;
  lastSeenAt: number | null;
  status: IdentityStatus;
  createdAt: number;
}

interface AgentDto {
  id: string;
  machineId: string;
  project: string;
  displayName: string;
  feishuAppId: string | null;
  status: IdentityStatus;
  allowedTargets: string[];
  createdAt: number;
  updatedAt: number;
}

function toMachineDto(row: MachineRecord): MachineDto {
  return {
    id: row.id,
    hostname: row.hostname,
    os: row.os,
    collectorVersion: row.collectorVersion,
    lastSeenAt: row.lastSeenAt,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function toAgentDto(row: AgentRecord): AgentDto {
  return {
    id: row.id,
    machineId: row.machineId,
    project: row.project,
    displayName: row.displayName,
    feishuAppId: row.feishuAppId,
    status: row.status,
    allowedTargets: parseJsonStringArray(row.allowedTargetsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sendError(reply: FastifyReply, error: IdentityError): FastifyReply {
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

function parseListQuery(
  query: Record<string, unknown>,
  reply: FastifyReply,
): { limit: number; before?: { createdAt: number; id: string } } | undefined {
  const limit = typeof query.limit === "string" ? Number(query.limit) : LIST_LIMITS.default;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMITS.max) {
    void reply.code(422).send({
      error: { code: "VALIDATION_FAILED", message: `limit 必须为 1~${LIST_LIMITS.max} 的整数` },
    });
    return undefined;
  }
  const before = typeof query.cursor === "string" ? parseKeysetCursor(query.cursor) : undefined;
  if (typeof query.cursor === "string" && before === undefined) {
    void reply.code(422).send({
      error: { code: "VALIDATION_FAILED", message: "cursor 格式应为 <createdAt>:<id>" },
    });
    return undefined;
  }
  return { limit, ...(before === undefined ? {} : { before }) };
}

export function registerIdentityRoutes(app: FastifyInstance, options: IdentityRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createIdentityService({ db, now });
  const session = requireSession(db, now);
  const writeGuards = [session, requireCsrf(), requireIdempotencyKey()];

  app.post("/api/machines", { preHandler: writeGuards }, async (request, reply) => {
    const parsed = machineCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    try {
      const { machine, secret } = service.registerMachine(parsed.data);
      return reply.code(201).send({ machine: toMachineDto(machine), secret });
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.post("/api/machines/:id/rotate", { preHandler: writeGuards }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { secret } = service.rotateMachineSecret(id);
      return { secret };
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.get("/api/machines", { preHandler: session }, async (request, reply) => {
    const query = parseListQuery(request.query as Record<string, unknown>, reply);
    if (query === undefined) {
      return reply;
    }
    const rows = service.listMachines(query);
    const last = rows.at(-1);
    return {
      items: rows.map(toMachineDto),
      nextCursor:
        rows.length === query.limit && last !== undefined ? formatKeysetCursor(last) : null,
    };
  });

  app.post("/api/agents", { preHandler: writeGuards }, async (request, reply) => {
    const parsed = agentCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    try {
      const { agent, secret } = service.registerAgent(parsed.data);
      return reply.code(201).send({ agent: toAgentDto(agent), secret });
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.post("/api/agents/:id/rotate", { preHandler: writeGuards }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { secret } = service.rotateAgentSecret(id);
      return { secret };
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.get("/api/agents", { preHandler: session }, async (request, reply) => {
    const query = parseListQuery(request.query as Record<string, unknown>, reply);
    if (query === undefined) {
      return reply;
    }
    const rows = service.listAgents(query);
    const last = rows.at(-1);
    return {
      items: rows.map(toAgentDto),
      nextCursor:
        rows.length === query.limit && last !== undefined ? formatKeysetCursor(last) : null,
    };
  });
}
