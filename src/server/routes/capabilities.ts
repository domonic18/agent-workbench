import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CAPABILITY_STATUSES,
  CAPABILITY_TTL,
  LIST_LIMITS,
  type CapabilityStatus,
} from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import type { CapabilityRecord } from "../../store/repositories/capability.js";
import { CapabilityError } from "../../domain/capability/errors.js";
import {
  createCapabilityService,
  type CapabilityService,
} from "../../domain/capability/service.js";
import type { TeleportAdapter } from "../../adapters/teleport/tctl.js";
import {
  requireCsrf,
  requireIdempotencyKey,
  requireSession,
} from "../middleware/session.js";

const CONSOLE_ACTOR = "console";

const createSchema = z.object({
  subject: z.string(),
  target: z.string(),
  action: z.string(),
  scope: z.record(z.string(), z.unknown()).default({}),
  ttlSeconds: z.number().int().default(CAPABILITY_TTL.defaultSeconds),
  taskId: z.string(),
});

const decisionSchema = z
  .object({ reason: z.string().max(500).optional() })
  .default({ reason: undefined });

export interface CapabilityRoutesOptions {
  db: Db;
  teleport: TeleportAdapter;
  now?: () => number;
  service?: CapabilityService;
  /** 申请成功后触发(入队飞书审批卡片);抛错不影响建单 */
  onRequested?: (record: CapabilityRecord) => void;
}

interface CapabilityDto {
  id: string;
  subject: string;
  target: string;
  action: string;
  scope: unknown;
  ttlSeconds: number;
  status: CapabilityStatus;
  ticketId: string | null;
  taskId: string;
  issuedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function parseScope(scopeJson: string): unknown {
  try {
    return JSON.parse(scopeJson) as unknown;
  } catch {
    return {};
  }
}

function toDto(row: CapabilityRecord): CapabilityDto {
  return {
    id: row.id,
    subject: row.subject,
    target: row.target,
    action: row.action,
    scope: parseScope(row.scopeJson),
    ttlSeconds: row.ttlSeconds,
    status: row.status,
    ticketId: row.ticketId,
    taskId: row.taskId,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sendError(reply: FastifyReply, error: CapabilityError): FastifyReply {
  return reply.code(error.status).send({
    error: {
      code: error.code,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    },
  });
}

function parseCursor(cursor: string): { createdAt: number; id: string } | undefined {
  const index = cursor.indexOf(":");
  if (index <= 0) {
    return undefined;
  }
  const createdAt = Number(cursor.slice(0, index));
  const id = cursor.slice(index + 1);
  if (!Number.isInteger(createdAt) || id === "") {
    return undefined;
  }
  return { createdAt, id };
}

export function registerCapabilityRoutes(
  app: FastifyInstance,
  options: CapabilityRoutesOptions,
): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service =
    options.service ?? createCapabilityService({ db, teleport: options.teleport, now });
  const session = requireSession(db, now);
  const writeGuards = [session, requireCsrf(), requireIdempotencyKey()];
  // 申请接口的幂等键 → 首次生成的 capability id;M3-2 落库后改为持久化
  const createdByKey = new Map<string, string>();

  app.get("/api/capabilities", { preHandler: session }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const status = typeof query.status === "string" ? query.status : undefined;
    if (status !== undefined && !CAPABILITY_STATUSES.includes(status as CapabilityStatus)) {
      return reply.code(422).send({
        error: {
          code: "VALIDATION_FAILED",
          message: `status 只接受 ${CAPABILITY_STATUSES.join(" / ")}`,
        },
      });
    }
    const limitText = typeof query.limit === "string" ? Number(query.limit) : LIST_LIMITS.default;
    if (!Number.isInteger(limitText) || limitText < 1 || limitText > LIST_LIMITS.max) {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: `limit 必须为 1~${LIST_LIMITS.max} 的整数` },
      });
    }
    const before =
      typeof query.cursor === "string" ? parseCursor(query.cursor) : undefined;
    if (typeof query.cursor === "string" && before === undefined) {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: "cursor 格式应为 <createdAt>:<id>" },
      });
    }

    const rows = service.list({
      ...(status === undefined ? {} : { status: status as CapabilityStatus }),
      limit: limitText,
      ...(before === undefined ? {} : { before }),
    });
    const items = rows.map(toDto);
    const last = rows.at(-1);
    return {
      items,
      nextCursor:
        rows.length === limitText && last !== undefined ? `${last.createdAt}:${last.id}` : null,
    };
  });

  app.post("/api/capabilities", { preHandler: writeGuards }, async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key === "string") {
      const existing = createdByKey.get(key);
      if (existing !== undefined) {
        const previous = service.find(existing);
        if (previous !== undefined) {
          return reply.code(201).send({ capability: toDto(previous) });
        }
      }
    }

    const parsed = createSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "授权申请字段缺失或类型错误",
          detail: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
    }

    try {
      const row = service.request({ ...parsed.data, actor: CONSOLE_ACTOR });
      if (typeof key === "string") {
        createdByKey.set(key, row.id);
      }
      if (options.onRequested !== undefined) {
        try {
          options.onRequested(row);
        } catch (error) {
          request.log.error({ err: error, capabilityId: row.id }, "审批卡片入队失败");
        }
      }
      return reply.code(201).send({ capability: toDto(row) });
    } catch (error) {
      if (error instanceof CapabilityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.post(
    "/api/capabilities/:id/approve",
    { preHandler: writeGuards },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const result = await service.approve(id, CONSOLE_ACTOR);
        return { applied: result.applied, capability: toDto(result.capability) };
      } catch (error) {
        if (error instanceof CapabilityError) {
          return sendError(reply, error);
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/capabilities/:id/reject",
    { preHandler: writeGuards },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = decisionSchema.safeParse(request.body ?? {});
      const reason = parsed.success ? parsed.data.reason : undefined;
      try {
        const result = service.reject(id, CONSOLE_ACTOR, reason);
        return { applied: result.applied, capability: toDto(result.capability) };
      } catch (error) {
        if (error instanceof CapabilityError) {
          return sendError(reply, error);
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/capabilities/:id/revoke",
    { preHandler: writeGuards },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = decisionSchema.safeParse(request.body ?? {});
      const reason = parsed.success ? parsed.data.reason : undefined;
      try {
        const result = service.revoke(id, CONSOLE_ACTOR, reason);
        return { applied: result.applied, capability: toDto(result.capability) };
      } catch (error) {
        if (error instanceof CapabilityError) {
          return sendError(reply, error);
        }
        throw error;
      }
    },
  );
}
