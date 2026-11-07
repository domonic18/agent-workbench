import type { Db } from "../../store/database.js";
import { findKnowledgeEntry } from "../../store/repositories/knowledge.js";
import type { EmbeddingClient } from "./embedding.js";
import {
  indexKnowledgeEntry,
  isMissingKnowledgeFile,
  type KnowledgeIndexOutcome,
} from "./indexer.js";

/** missing:元数据还在但 Markdown 已不在,交给外部编辑扫描标记删除 */
export type KnowledgeReindexResult = KnowledgeIndexOutcome | "missing";

export class KnowledgeEntryNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`知识条目不存在: ${id}`);
    this.name = "KnowledgeEntryNotFoundError";
  }
}

export interface KnowledgeIndexServiceOptions {
  db: Db;
  knowledgeDir: string;
  embedding?: EmbeddingClient;
  now?: () => number;
}

export interface KnowledgeIndexService {
  /** 列表里 pending / failed 条目按 id 重试,失败不拖累整库 */
  reindexEntry(id: string): Promise<KnowledgeReindexResult>;
}

export function createKnowledgeIndexService(
  options: KnowledgeIndexServiceOptions,
): KnowledgeIndexService {
  return {
    async reindexEntry(id) {
      const entry = await findKnowledgeEntry(options.db, id);
      if (entry === undefined || entry.deletedAt !== null) {
        throw new KnowledgeEntryNotFoundError(id);
      }
      try {
        return await indexKnowledgeEntry(options.db, entry, {
          knowledgeDir: options.knowledgeDir,
          ...(options.embedding === undefined ? {} : { embedding: options.embedding }),
          ...(options.now === undefined ? {} : { now: options.now }),
        });
      } catch (error) {
        if (isMissingKnowledgeFile(error)) {
          return "missing";
        }
        throw error;
      }
    },
  };
}
