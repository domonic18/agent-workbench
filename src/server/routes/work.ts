import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createIngestService } from "../../domain/work/ingest-service.js";
import { WorkIngestError } from "../../domain/work/contract.js";
import type { Db } from "../../store/database.js";
import { requireCsrf, requireIdempotencyKey, requireSession } from "../middleware/session.js";

/**
 * 归一化触发入口(arch/01 §9.1):一期是控制台会话的管理面/联调通道,
 * 不是匿名 webhook——真实 Bug/Git/CI 适配器按同一 WorkRequest 契约随 M3.9-2 接入。
 * 幂等以 (source, source_event_id) 首到先得,重放返回首次处置。
 */
const threadRefSchema = z.object({
  source: z.string().min(1),
  externalKind: z.string().min(1),
  externalKey: z.string().min(1),
});

const triggerSchema = z.object({
  source: z.string().min(1),
  sourceEventId: z.string().min(1),
  kind: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  actor: z.record(z.string(), z.unknown()),
  project: z.string().min(1).optional(),
  threadRefs: z.array(threadRefSchema),
  payload: z.record(z.string(), z.unknown()),
  refs: z.array(z.unknown()),
  authorizationRef: z.string().min(1).optional(),
});

export interface WorkRoutesOptions {
  db: Db;
  now?: () => number;
}

export function registerWorkRoutes(app: FastifyInstance, options: WorkRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const ingest = createIngestService({ db, now }).ingest;
  const writeGuards = [requireSession(db, now), requireCsrf(), requireIdempotencyKey()];

  app.post("/api/work/triggers", { preHandler: writeGuards }, async (request, reply) => {
    const parsed = triggerSchema.safeParse(request.body ?? {});
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
    try {
      const result = await ingest(parsed.data);
      return {
        replayed: result.replayed,
        trigger: result.trigger,
        workItem: result.workItem ?? null,
        inboxIds: result.inboxIds,
      };
    } catch (error) {
      if (error instanceof WorkIngestError) {
        return reply.code(422).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
}
