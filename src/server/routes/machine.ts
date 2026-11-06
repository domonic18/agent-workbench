import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IdentityError } from "../../domain/identity/errors.js";
import { createIdentityService, type IdentityService } from "../../domain/identity/service.js";
import { createIdempotencyService, type IdempotencyService } from "../../domain/security/idempotency.js";
import { type IdentityStatus } from "../../shared/constants.js";
import { formatKeysetCursor } from "../../shared/cursor.js";
import type { Db } from "../../store/database.js";
import type { MachineRecord } from "../../store/repositories/machine.js";
import { findMachineById } from "../../store/repositories/machine.js";
import { requireCsrf, requireIdempotencyKey, requireSession } from "../middleware/session.js";
import { domainError, invalidSchema, parseListQuery } from "./http.js";

/**
 * 机器身份路由:登记 / 密钥轮换 / 列表 / 改展示名。
 * 与 Agent 身份路由(identity.ts)分开,避免单个路由文件膨胀。
 */

const machineCreateSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  os: z.string(),
  collectorVersion: z.string(),
});

const machineRenameSchema = z
  .object({
    displayName: z.string().min(1).max(128),
  })
  .strict();

export interface MachineDto {
  id: string;
  hostname: string;
  /** 展示名:控制台可改,默认等于 hostname */
  displayName: string;
  os: string;
  collectorVersion: string;
  lastSeenAt: number | null;
  status: IdentityStatus;
  createdAt: number;
}

export function toMachineDto(row: MachineRecord): MachineDto {
  return {
    id: row.id,
    hostname: row.hostname,
    displayName: row.displayName ?? row.hostname,
    os: row.os,
    collectorVersion: row.collectorVersion,
    lastSeenAt: row.lastSeenAt,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export interface MachineRoutesOptions {
  db: Db;
  now?: () => number;
  service?: IdentityService;
  idempotency?: IdempotencyService;
}

export function registerMachineRoutes(app: FastifyInstance, options: MachineRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createIdentityService({ db, now });
  const idempotency = options.idempotency ?? createIdempotencyService({ db, now });
  const session = requireSession(db, now);
  const writeGuards = [session, requireCsrf(), requireIdempotencyKey()];

  app.post("/api/machines", { preHandler: writeGuards }, async (request, reply) => {
    const parsed = machineCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidSchema(reply, parsed.error);
    }
    try {
      const { machine, secret } = await service.registerMachine(parsed.data);
      return reply.code(201).send({ machine: toMachineDto(machine), secret });
    } catch (error) {
      if (error instanceof IdentityError) {
        return domainError(reply, error);
      }
      throw error;
    }
  });

  app.post("/api/machines/:id/rotate", { preHandler: writeGuards }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { secret } = await service.rotateMachineSecret(id);
      return { secret };
    } catch (error) {
      if (error instanceof IdentityError) {
        return domainError(reply, error);
      }
      throw error;
    }
  });

  app.patch("/api/machines/:id", { preHandler: writeGuards }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = machineRenameSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidSchema(reply, parsed.error);
    }
    const key = request.headers["idempotency-key"] as string;
    const scope = `machine.rename:${id}`;
    const existingId = await idempotency.find(scope, key);
    if (existingId !== undefined) {
      const previous = await findMachineById(db, existingId);
      if (previous !== undefined) {
        return { machine: toMachineDto(previous), replayed: true };
      }
    }
    try {
      const machine = await idempotency.run(scope, key, () =>
        service.renameMachine(id, parsed.data.displayName),
      );
      return { machine: toMachineDto(machine), replayed: false };
    } catch (error) {
      if (error instanceof IdentityError) {
        return domainError(reply, error);
      }
      throw error;
    }
  });

  app.get("/api/machines", { preHandler: session }, async (request, reply) => {
    const query = parseListQuery(request.query as Record<string, unknown>, reply);
    if (query === undefined) {
      return reply;
    }
    const rows = await service.listMachines(query);
    const last = rows.at(-1);
    return {
      items: rows.map(toMachineDto),
      nextCursor:
        rows.length === query.limit && last !== undefined ? formatKeysetCursor(last) : null,
    };
  });
}
