import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { KnowledgeStatus } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  countKnowledgeEntriesByStatus,
  findKnowledgeEntry,
  invalidateKnowledgeIndex,
  listKnowledgeEntries,
  updateKnowledgeEntryMeta,
  updateKnowledgeEntryStatus,
  type KnowledgeEntryRecord,
  type KnowledgeListQuery,
  type KnowledgeMetaUpdate,
  type KnowledgeStatusCounts,
} from "../../store/repositories/knowledge.js";
import { isMissingKnowledgeFile } from "./indexer.js";
import type { KnowledgeIndexService } from "./index-service.js";
import { isProtectedKnowledgePath, resolveEntryPath } from "./paths.js";
import {
  assertKnowledgeStatusTransition,
  InvalidKnowledgeTransitionError,
} from "./state-machine.js";

export type KnowledgeErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "PROTECTED"
  | "KNOWLEDGE_FILE_MISSING";

const ERROR_STATUS: Record<KnowledgeErrorCode, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  PROTECTED: 403,
  KNOWLEDGE_FILE_MISSING: 409,
};

export class KnowledgeError extends Error {
  readonly status: number;

  constructor(
    readonly code: KnowledgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeError";
    this.status = ERROR_STATUS[code];
  }
}

export interface KnowledgeEntryServiceOptions {
  db: Db;
  knowledgeDir: string;
  /** 编辑 / 采纳后单条重建;缺省时只更新镜像,索引留待整库重建 */
  indexer?: KnowledgeIndexService;
  now?: () => number;
}

export interface KnowledgeUpdateInput {
  content: string;
  title?: string;
  summary?: string;
  category?: string;
}

export interface KnowledgeEntryRead {
  entry: KnowledgeEntryRecord;
  content: string;
}

export interface KnowledgeEntryList {
  items: KnowledgeEntryRecord[];
  counts: KnowledgeStatusCounts;
}

export interface KnowledgeEntryService {
  list(query: KnowledgeListQuery): KnowledgeEntryList;
  read(id: string): Promise<KnowledgeEntryRead>;
  update(id: string, input: KnowledgeUpdateInput): Promise<KnowledgeEntryRecord>;
  adopt(id: string): Promise<KnowledgeEntryRecord>;
  archive(id: string): Promise<KnowledgeEntryRecord>;
}

export function createKnowledgeEntryService(
  options: KnowledgeEntryServiceOptions,
): Promise<KnowledgeEntryService>{
  const db = options.db;
  const now = options.now ?? Date.now;

  function requireEntry(id: string): KnowledgeEntryRecord {
    const entry = findKnowledgeEntry(db, id);
    if (entry === undefined || entry.deletedAt !== null) {
      throw new KnowledgeError("NOT_FOUND", `知识条目不存在: ${id}`);
    }
    return entry;
  }

  async function reindex(id: string): Promise<void> {
    if (options.indexer === undefined) {
      return;
    }
    try {
      await options.indexer.reindexEntry(id);
    } catch {
      // 嵌入或文件异常不拖垮写操作:条目留在 pending / failed,列表可重试
    }
  }

  function changeStatus(
    entry: KnowledgeEntryRecord,
    target: KnowledgeStatus,
  ): KnowledgeEntryRecord {
    if (entry.status === target) {
      return entry;
    }
    try {
      assertKnowledgeStatusTransition(entry.status, target);
    } catch (error) {
      if (error instanceof InvalidKnowledgeTransitionError) {
        throw new KnowledgeError("CONFLICT", error.message);
      }
      throw error;
    }
    if (!updateKnowledgeEntryStatus(db, entry.id, target, now())) {
      throw new KnowledgeError("NOT_FOUND", `知识条目不存在: ${entry.id}`);
    }
    return requireEntry(entry.id);
  }

  return {
    list(query) {
      return {
        items: listKnowledgeEntries(db, query),
        counts: countKnowledgeEntriesByStatus(db),
      };
    },

    async read(id) {
      const entry = requireEntry(id);
      try {
        const content = await readFile(resolveEntryPath(options.knowledgeDir, entry.path), "utf8");
        return { entry, content };
      } catch (error) {
        if (isMissingKnowledgeFile(error)) {
          throw new KnowledgeError("KNOWLEDGE_FILE_MISSING", "知识文件不存在");
        }
        throw error;
      }
    },

    async update(id, input) {
      const entry = requireEntry(id);
      if (isProtectedKnowledgePath(entry.path)) {
        throw new KnowledgeError("PROTECTED", `受保护文件只读: ${entry.path}`);
      }
      const fullPath = resolveEntryPath(options.knowledgeDir, entry.path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, input.content, "utf8");

      const timestamp = now();
      const meta: KnowledgeMetaUpdate = { id, now: timestamp };
      if (input.title !== undefined) {
        meta.title = input.title;
      }
      if (input.summary !== undefined) {
        meta.summary = input.summary;
      }
      if (input.category !== undefined) {
        meta.category = input.category;
      }
      db.transaction(async () => {
        if (!updateKnowledgeEntryMeta(db, meta)) {
          throw new KnowledgeError("NOT_FOUND", `知识条目不存在: ${id}`);
        }
        invalidateKnowledgeIndex(db, id, timestamp);
      });

      await reindex(id);
      return requireEntry(id);
    },

    async adopt(id) {
      const updated = changeStatus(requireEntry(id), "active");
      await reindex(id);
      return requireEntry(updated.id);
    },

    async archive(id) {
      return changeStatus(requireEntry(id), "archived");
    },
  };
}
