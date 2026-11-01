import type { FastifyInstance, FastifyReply } from "fastify";
import {
  KnowledgeEntryNotFoundError,
  type KnowledgeIndexService,
} from "../../domain/knowledge/index-service.js";
import type { KnowledgeRebuilder } from "../../domain/knowledge/rebuild.js";
import type { Db } from "../../store/database.js";
import { requireCsrf, requireIdempotencyKey, requireSession } from "../middleware/session.js";

export interface KnowledgeRoutesOptions {
  db: Db;
  rebuilder: KnowledgeRebuilder;
  /** 注入才开放单条重试;缺省时只有整库重建 */
  indexer?: KnowledgeIndexService;
  now?: () => number;
}

function sendConflict(reply: FastifyReply, code: string, message: string): FastifyReply {
  return reply.code(409).send({ error: { code, message } });
}

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  options: KnowledgeRoutesOptions,
): void {
  const session = requireSession(options.db, options.now ?? Date.now);
  const writeGuards = [session, requireCsrf(), requireIdempotencyKey()];
  const indexer = options.indexer;

  app.post("/api/knowledge/rebuild", { preHandler: writeGuards }, async (request, reply) => {
    if (options.rebuilder.isRunning()) {
      return sendConflict(reply, "CONFLICT", "索引重建正在进行");
    }
    void options.rebuilder.start().catch((error: unknown) => {
      request.log.warn({ err: error }, "知识索引重建失败");
    });
    return reply.code(202).send({ started: true });
  });

  if (indexer === undefined) {
    return;
  }

  app.post(
    "/api/knowledge/entries/:id/reindex",
    { preHandler: writeGuards },
    async (request, reply) => {
      // 整库重建占用写连接,并发单条重建会撞 SQLITE_BUSY
      if (options.rebuilder.isRunning()) {
        return sendConflict(reply, "CONFLICT", "索引重建正在进行");
      }
      const { id } = request.params as { id: string };
      try {
        const outcome = await indexer.reindexEntry(id);
        if (outcome === "missing") {
          return sendConflict(reply, "KNOWLEDGE_FILE_MISSING", "知识文件不存在");
        }
        return { outcome };
      } catch (error) {
        if (error instanceof KnowledgeEntryNotFoundError) {
          return reply.code(404).send({ error: { code: "NOT_FOUND", message: error.message } });
        }
        throw error;
      }
    },
  );
}
