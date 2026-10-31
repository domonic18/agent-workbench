import type { FastifyInstance } from "fastify";
import { AUDIT_GAP_KINDS, type AuditGapKind } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  listGaps,
  type AuditGapRecord,
} from "../../store/repositories/audit-reconcile.js";
import { requireSession } from "../middleware/session.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

function parseDetail(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return {};
  }
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
    detail: parseDetail(row.detailJson),
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
  const now = options.now ?? Date.now;
  const session = requireSession(db, now);

  app.get("/api/audit/gaps", { preHandler: session }, async (request, reply) => {
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
    const limitText = typeof query.limit === "string" ? Number(query.limit) : DEFAULT_LIMIT;
    if (!Number.isInteger(limitText) || limitText < 1 || limitText > MAX_LIMIT) {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: `limit 必须为 1~${MAX_LIMIT} 的整数` },
      });
    }
    const before = typeof query.cursor === "string" ? parseCursor(query.cursor) : undefined;
    if (typeof query.cursor === "string" && before === undefined) {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: "cursor 格式应为 <detectedAt>:<id>" },
      });
    }

    const rows = listGaps(db, {
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
