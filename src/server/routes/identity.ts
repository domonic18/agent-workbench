import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { IdentityError } from "../../domain/identity/errors.js";
import { createIdentityService, type IdentityService } from "../../domain/identity/service.js";
import { AGENT_RUNTIMES, LIST_LIMITS, type AgentRuntime, type IdentityStatus } from "../../shared/constants.js";
import { formatKeysetCursor, parseKeysetCursor } from "../../shared/cursor.js";
import type { Db } from "../../store/database.js";
import { parseJsonStringArray } from "../../store/json.js";
import type { AgentRecord, MachineRecord } from "../../store/repositories/identity.js";
import {
  listAgentRosterRows,
  type AgentRosterRow,
} from "../../store/repositories/agent-roster.js";
import { findUsageLimitByAgentId, findUsageLimitsByAgentIds, type UsageLimitRecord } from "../../store/repositories/usage-limit.js";
import { requireCsrf, requireIdempotencyKey, requireSession } from "../middleware/session.js";

const machineCreateSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  os: z.string(),
  collectorVersion: z.string(),
});

const agentCreateSchema = z.object({
  machineId: z.string().nullable().optional(),
  runtime: z.enum(AGENT_RUNTIMES).optional(),
  /** 机器无关 Agent 的稳定 key:Git 项目注册表引用的路由目标 */
  key: z.string().optional(),
  project: z.string(),
  displayName: z.string(),
  feishuAppId: z.string().nullable().optional(),
  allowedTargets: z.array(z.string()).optional(),
});

const agentTargetsSchema = z.object({
  targets: z.array(z.string()),
});

const usageLimitSchema = z.object({
  dailyTokenLimit: z.number().int().nonnegative(),
  warnPercent: z.number().int().min(0).max(100).optional(),
  hardStop: z.boolean().optional(),
  isActive: z.boolean().optional(),
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

interface UsageLimitDto {
  dailyTokenLimit: number;
  warnPercent: number;
  hardStop: boolean;
  isActive: boolean;
  updatedAt: number;
}

interface AgentDto {
  id: string;
  machineId: string | null;
  runtime: AgentRuntime;
  /** 稳定 key;机器绑定 Agent 由初始化流程派生,人工注册可缺省 */
  key: string | null;
  project: string;
  displayName: string;
  feishuAppId: string | null;
  status: IdentityStatus;
  allowedTargets: string[];
  createdAt: number;
  updatedAt: number;
  usageLimit: UsageLimitDto | null;
}

export type { AgentDto, MachineDto, UsageLimitDto };

/** 名册视图:身份档案 + 用量与在办聚合,供控制台 Agent 管理表格 */
interface AgentRosterDto extends AgentDto {
  machineHostname: string | null;
  totalRuns: number;
  totalTokens: number;
  openTasks: number;
  lastRunAt: number | null;
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

function toUsageLimitDto(row: UsageLimitRecord): UsageLimitDto {
  return {
    dailyTokenLimit: row.dailyTokenLimit,
    warnPercent: row.warnPercent,
    hardStop: row.hardStop,
    isActive: row.isActive,
    updatedAt: row.updatedAt,
  };
}

export async function toAgentDto(
  db: Db,
  row: AgentRecord,
  limit?: UsageLimitRecord | undefined,
): Promise<AgentDto> {
  const resolved = limit === undefined ? await findUsageLimitByAgentId(db, row.id) : limit;
  return {
    id: row.id,
    machineId: row.machineId,
    runtime: row.runtime,
    key: row.key,
    project: row.project,
    displayName: row.displayName,
    feishuAppId: row.feishuAppId,
    status: row.status,
    allowedTargets: parseJsonStringArray(row.allowedTargetsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usageLimit: resolved === undefined ? null : toUsageLimitDto(resolved),
  };
}

function toAgentRosterDto(
  row: AgentRosterRow,
  limit: UsageLimitRecord | undefined,
): AgentRosterDto {
  return {
    id: row.id,
    machineId: row.machineId,
    runtime: row.runtime,
    key: row.key,
    project: row.project,
    displayName: row.displayName,
    feishuAppId: row.feishuAppId,
    status: row.status,
    allowedTargets: parseJsonStringArray(row.allowedTargetsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usageLimit: limit === undefined ? null : toUsageLimitDto(limit),
    machineHostname: row.machineHostname,
    totalRuns: row.totalRuns,
    totalTokens: row.totalTokens,
    openTasks: row.openTasks,
    lastRunAt: row.lastRunAt,
  };
}

export function sendError(reply: FastifyReply, error: IdentityError): FastifyReply {
  return reply.code(error.status).send({
    error: {
      code: error.code,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    },
  });
}

export function validationError(reply: FastifyReply, issues: z.ZodError): FastifyReply {
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
      const { machine, secret } = await service.registerMachine(parsed.data);
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
      const { secret } = await service.rotateMachineSecret(id);
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
    const rows = await service.listMachines(query);
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
      const { agent, secret } = await service.registerAgent(parsed.data);
      return reply.code(201).send({ agent: await toAgentDto(db, agent), secret });
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
      const { secret } = await service.rotateAgentSecret(id);
      return { secret };
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.put("/api/agents/:id/targets", { preHandler: writeGuards }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = agentTargetsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    try {
      const agent = await service.setAllowedTargets(id, parsed.data.targets);
      return { agent: await toAgentDto(db, agent) };
    } catch (error) {
      if (error instanceof IdentityError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });

  app.put("/api/agents/:id/usage-limit", { preHandler: writeGuards }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = usageLimitSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    try {
      const agent = await service.setUsageLimit(id, parsed.data);
      return { agent: await toAgentDto(db, agent) };
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
    const rows = await listAgentRosterRows(db, query);
    const limits = await findUsageLimitsByAgentIds(
      db,
      rows.map((row) => row.id),
    );
    const last = rows.at(-1);
    return {
      items: rows.map((row) => toAgentRosterDto(row, limits.get(row.id))),
      nextCursor:
        rows.length === query.limit && last !== undefined ? formatKeysetCursor(last) : null,
    };
  });
}
