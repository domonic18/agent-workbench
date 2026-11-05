import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AUDIT_GAP_KINDS,
  LIST_LIMITS,
  TOOL_LEVELS,
  TOOL_VERDICTS,
  type AuditGapKind,
} from "../../shared/constants.js";
import { parseJsonObject } from "../../shared/json.js";
import type { Db } from "../../store/database.js";
import {
  listGaps,
  type AuditGapRecord,
} from "../../store/repositories/audit-reconcile.js";
import { createAuditService, type ToolCallPayload } from "../../domain/audit/service.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";
import { requireSession } from "../middleware/session.js";

/** proxy 判定后落审计(05 §6.4);agent_id 不在负载里,按 Bearer 身份注入 */
const toolCallSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  tool: z.string().min(1),
  argsHash: z.string().regex(/^[0-9a-f]{64}$/),
  level: z.enum(TOOL_LEVELS),
  verdict: z.enum(TOOL_VERDICTS),
  reason: z.string().nullish(),
  capabilityId: z.string().nullish(),
  durationMs: z.number().int().min(0).nullish(),
  occurredAt: z.number().int().positive(),
});

export interface AuditRoutesOptions {
  db: Db;
  now?: () => number;
}

interface AuditGapDto {
  id: number;
  kind: AuditGapKind;
  toolCallLogId: number | null;
  capabilityId: string | null;
  taskId: string | null;
  ticketId: string | null;
  sid: string | null;
  detail: unknown;
  detectedAt: number;
}

function toDto(row: AuditGapRecord): AuditGapDto {
  return {
    id: row.id,
    kind: row.kind,
    toolCallLogId: row.toolCallLogId,
    capabilityId: row.capabilityId,
    taskId: row.taskId,
    ticketId: row.ticketId,
    sid: row.sid,
    detail: parseJsonObject(row.detailJson),
    detectedAt: row.detectedAt,
  };
}

/** 游标格式 `<detectedAt>:<id>` */
function parseCursor(cursor: string): { detectedAt: number; id: number } | undefined {
  const index = cursor.indexOf(":");
  if (index <= 0) {
    return undefined;
  }
  const detectedAt = Number(cursor.slice(0, index));
  const id = Number(cursor.slice(index + 1));
  if (!Number.isInteger(detectedAt) || !Number.isInteger(id)) {
    return undefined;
  }
  return { detectedAt, id };
}

export function registerAuditRoutes(app: FastifyInstance, options: AuditRoutesOptions): void {
  const db = options.db;
  const auditService = createAuditService({ db });

  app.post(
    "/api/audit/tool-calls",
    { preHandler: requireAgentAuth(db) },
    async (request, reply) => {
      const agent = request.agent!;
      const parsed = toolCallSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(422).send({
          error: {
            code: "VALIDATION_FAILED",
            message: "字段缺失或类型错误",
            detail: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        });
      }
      const data = parsed.data;
      const payload: ToolCallPayload = {
        runId: data.runId,
        taskId: data.taskId,
        tool: data.tool,
        argsHash: data.argsHash,
        level: data.level,
        verdict: data.verdict,
        reason: data.reason ?? null,
        capabilityId: data.capabilityId ?? null,
        durationMs: data.durationMs ?? null,
        occurredAt: data.occurredAt,
      };
      const result = await auditService.recordToolCall(agent.id, payload);
      if (!result.ok) {
        return reply.code(result.code === "NOT_FOUND" ? 404 : 403).send({
          error: { code: result.code, message: result.message },
        });
      }
      return reply.code(201).send({ ok: true });
    },
  );

  app.get("/api/audit/gaps", { preHandler: requireSession(db, options.now ?? Date.now) }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const kind = typeof query.kind === "string" ? query.kind : undefined;
    if (kind !== undefined && !AUDIT_GAP_KINDS.includes(kind as AuditGapKind)) {
      return reply.code(422).send({
        error: {
          code: "VALIDATION_FAILED",
          message: `kind 只接受 ${AUDIT_GAP_KINDS.join(" / ")}`,
        },
      });
    }
    const limitText = typeof query.limit === "string" ? Number(query.limit) : LIST_LIMITS.default;
    if (!Number.isInteger(limitText) || limitText < 1 || limitText > LIST_LIMITS.max) {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: `limit 必须为 1~${LIST_LIMITS.max} 的整数` },
      });
    }
    const before = typeof query.cursor === "string" ? parseCursor(query.cursor) : undefined;
    if (typeof query.cursor === "string" && before === undefined) {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: "cursor 格式应为 <detectedAt>:<id>" },
      });
    }

    const rows = await listGaps(db, {
      ...(kind === undefined ? {} : { kind: kind as AuditGapKind }),
      limit: limitText,
      ...(before === undefined ? {} : { before }),
    });
    const last = rows.at(-1);
    return {
      items: rows.map(toDto),
      nextCursor:
        rows.length === limitText && last !== undefined ? `${last.detectedAt}:${last.id}` : null,
    };
  });
}
