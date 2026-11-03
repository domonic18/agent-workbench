import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  KnowledgeEntryNotFoundError,
  type KnowledgeIndexService,
} from "../../domain/knowledge/index-service.js";
import {
  KnowledgeError,
  type KnowledgeEntryService,
} from "../../domain/knowledge/entry-service.js";
import { isProtectedKnowledgePath } from "../../domain/knowledge/paths.js";
import type { KnowledgeRebuilder } from "../../domain/knowledge/rebuild.js";
import {
  KNOWLEDGE_LIMITS,
  KNOWLEDGE_STATUSES,
  LIST_LIMITS,
  type KnowledgeEmbeddingStatus,
  type KnowledgeStatus,
} from "../../shared/constants.js";
import { formatKeysetCursor, parseKeysetCursor } from "../../shared/cursor.js";
import type { Db } from "../../store/database.js";
import type { KnowledgeEntryRecord } from "../../store/repositories/knowledge.js";
import { invalid } from "./http.js";
import { requireCsrf, requireIdempotencyKey, requireSession } from "../middleware/session.js";

export interface KnowledgeRoutesOptions {
  db: Db;
  rebuilder: KnowledgeRebuilder;
  /** 注入才开放单条重试;缺省时只有整库重建 */
  indexer?: KnowledgeIndexService;
  /** 注入才开放列表 / 详情 / 编辑 / 采纳;缺省时只有索引重建 */
  entries?: KnowledgeEntryService;
  now?: () => number;
}

interface KnowledgeEntryDto {
  id: string;
  path: string;
  title: string;
  summary: string;
  category: string;
  status: KnowledgeStatus;
  sourceTaskId: string | null;
  sourceAgentId: string | null;
  embeddingStatus: KnowledgeEmbeddingStatus;
  protected: boolean;
  createdAt: number;
  updatedAt: number;
}

const listQuerySchema = z.object({
  status: z.enum(KNOWLEDGE_STATUSES).default("active"),
  q: z.string().max(KNOWLEDGE_LIMITS.search).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_LIMITS.max).default(LIST_LIMITS.default),
  cursor: z.string().optional(),
});

const updateSchema = z.object({
  content: z.string().max(KNOWLEDGE_LIMITS.content),
  title: z.string().min(1).max(KNOWLEDGE_LIMITS.title).optional(),
  summary: z.string().max(KNOWLEDGE_LIMITS.summary).optional(),
  category: z.string().max(KNOWLEDGE_LIMITS.category).optional(),
});

function toDto(row: KnowledgeEntryRecord): KnowledgeEntryDto {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    summary: row.summary,
    category: row.category,
    status: row.status,
    sourceTaskId: row.sourceTaskId,
    sourceAgentId: row.sourceAgentId,
    embeddingStatus: row.embeddingStatus,
    protected: isProtectedKnowledgePath(row.path),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sendKnowledgeError(reply: FastifyReply, error: KnowledgeError): FastifyReply {
  return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
}

function sendConflict(reply: FastifyReply, code: string, message: string): FastifyReply {
  return reply.code(409).send({ error: { code, message } });
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

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  options: KnowledgeRoutesOptions,
): Promise<void>{
  const session = requireSession(options.db, options.now ?? Date.now);
  const writeGuards = [session, requireCsrf(), requireIdempotencyKey()];
  const indexer = options.indexer;
  const entries = options.entries;

  app.post("/api/knowledge/rebuild", { preHandler: writeGuards }, async (request, reply) => {
    if (options.rebuilder.isRunning()) {
      return sendConflict(reply, "CONFLICT", "索引重建正在进行");
    }
    void options.rebuilder.start().catch((error: unknown) => {
      request.log.warn({ err: error }, "知识索引重建失败");
    });
    return reply.code(202).send({ started: true });
  });

  if (entries !== undefined) {
    app.get("/api/knowledge", { preHandler: session }, async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return validationError(reply, parsed.error);
      }
      const { status, q, limit, cursor } = parsed.data;
      const before = cursor === undefined ? undefined : parseKeysetCursor(cursor);
      if (cursor !== undefined && before === undefined) {
        return invalid(reply, "cursor 格式应为 <updatedAt>:<id>");
      }
      const search = q === undefined || q.trim() === "" ? undefined : q.trim();

      const result = entries.list({
        status,
        limit,
        ...(search === undefined ? {} : { search }),
        ...(before === undefined
          ? {}
          : { before: { updatedAt: before.createdAt, id: before.id } }),
      });
      const last = result.items.at(-1);
      return {
        items: result.items.map(toDto),
        counts: result.counts,
        nextCursor:
          result.items.length === limit && last !== undefined
            ? formatKeysetCursor({ createdAt: last.updatedAt, id: last.id })
            : null,
      };
    });

    app.get("/api/knowledge/:id", { preHandler: session }, async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const { entry, content } = await entries.read(id);
        return { entry: toDto(entry), content };
      } catch (error) {
        if (error instanceof KnowledgeError) {
          return sendKnowledgeError(reply, error);
        }
        throw error;
      }
    });

    app.put("/api/knowledge/:id", { preHandler: writeGuards }, async (request, reply) => {
      if (options.rebuilder.isRunning()) {
        return sendConflict(reply, "CONFLICT", "索引重建正在进行");
      }
      const { id } = request.params as { id: string };
      const parsed = updateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return validationError(reply, parsed.error);
      }
      try {
        const { content, title, summary, category } = parsed.data;
        const entry = await entries.update(id, {
          content,
          ...(title === undefined ? {} : { title }),
          ...(summary === undefined ? {} : { summary }),
          ...(category === undefined ? {} : { category }),
        });
        return { entry: toDto(entry) };
      } catch (error) {
        if (error instanceof KnowledgeError) {
          return sendKnowledgeError(reply, error);
        }
        throw error;
      }
    });

    app.post(
      "/api/knowledge/:id/adopt",
      { preHandler: writeGuards },
      async (request, reply) => {
        if (options.rebuilder.isRunning()) {
          return sendConflict(reply, "CONFLICT", "索引重建正在进行");
        }
        const { id } = request.params as { id: string };
        try {
          const entry = await entries.adopt(id);
          return { entry: toDto(entry) };
        } catch (error) {
          if (error instanceof KnowledgeError) {
            return sendKnowledgeError(reply, error);
          }
          throw error;
        }
      },
    );

    app.post(
      "/api/knowledge/:id/archive",
      { preHandler: writeGuards },
      async (request, reply) => {
        if (options.rebuilder.isRunning()) {
          return sendConflict(reply, "CONFLICT", "索引重建正在进行");
        }
        const { id } = request.params as { id: string };
        try {
          const entry = await entries.archive(id);
          return { entry: toDto(entry) };
        } catch (error) {
          if (error instanceof KnowledgeError) {
            return sendKnowledgeError(reply, error);
          }
          throw error;
        }
      },
    );
  }

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
