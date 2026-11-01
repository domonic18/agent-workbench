import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { KNOWLEDGE_INDEX, type KnowledgeEmbeddingStatus } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  deleteKnowledgeChunks,
  insertKnowledgeChunk,
  listIndexableEntries,
  listKnowledgeChunkIds,
  updateKnowledgeIndex,
  type KnowledgeEntryRecord,
} from "../../store/repositories/knowledge.js";
import {
  deleteKnowledgeVectors,
  ensureKnowledgeVectorTable,
  insertKnowledgeVector,
} from "../../store/repositories/knowledge-vector.js";
import { splitMarkdown } from "./chunk.js";
import type { EmbeddingClient } from "./embedding.js";
import { hashKnowledgeContent } from "./hash.js";

export interface KnowledgeIndexOptions {
  knowledgeDir: string;
  embedding?: EmbeddingClient;
  now?: () => number;
  /** 强制重嵌入;常规重建保留「内容未变即跳过」 */
  force?: boolean;
}

export type KnowledgeIndexOutcome = "skipped" | "ready" | "pending" | "failed";

export interface KnowledgeRebuildResult {
  indexed: number;
  skipped: number;
  failed: number;
  missing: number;
}

function resolveEntryPath(knowledgeDir: string, path: string): string {
  const root = resolve(knowledgeDir);
  const fullPath = resolve(root, path);
  if (!fullPath.startsWith(root + sep)) {
    throw new Error(`知识路径越出知识目录: ${path}`);
  }
  return fullPath;
}

async function embedChunks(
  client: EmbeddingClient,
  chunks: readonly string[],
): Promise<Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (let start = 0; start < chunks.length; start += KNOWLEDGE_INDEX.embedBatchSize) {
    const batch = chunks.slice(start, start + KNOWLEDGE_INDEX.embedBatchSize);
    vectors.push(...(await client.embed(batch)));
  }
  return vectors;
}

/**
 * 单条重建:先算哈希与嵌入(异步),再在一个事务内替换分块、FTS 与向量,
 * 避免重建中途被检索读到半成品。嵌入失败仍写关键词索引并标 failed。
 */
export async function indexKnowledgeEntry(
  db: Db,
  entry: KnowledgeEntryRecord,
  options: KnowledgeIndexOptions,
): Promise<KnowledgeIndexOutcome> {
  const content = await readFile(resolveEntryPath(options.knowledgeDir, entry.path), "utf8");
  const contentHash = hashKnowledgeContent(content);
  if (
    options.force !== true &&
    entry.contentHash === contentHash &&
    entry.embeddingStatus === "ready"
  ) {
    return "skipped";
  }

  const chunks = splitMarkdown(content);
  let vectors: Float32Array[] | undefined;
  let embeddingFailed = false;
  if (options.embedding !== undefined && chunks.length > 0) {
    try {
      vectors = await embedChunks(options.embedding, chunks);
    } catch {
      embeddingFailed = true;
    }
  }

  let usesVectors = vectors !== undefined || entry.embeddingStatus === "ready";
  if (usesVectors) {
    try {
      ensureKnowledgeVectorTable(db);
    } catch {
      // 原生扩展不可用不拖垮关键词索引:本次退化为 pending,待修复后重建
      vectors = undefined;
      usesVectors = false;
    }
  }

  const status: KnowledgeEmbeddingStatus = embeddingFailed
    ? "failed"
    : vectors === undefined
      ? "pending"
      : "ready";
  const now = (options.now ?? Date.now)();

  db.transaction(() => {
    const oldChunkIds = listKnowledgeChunkIds(db, entry.id);
    deleteKnowledgeChunks(db, entry.id);
    const newChunkIds = chunks.map((chunk, index) =>
      insertKnowledgeChunk(db, entry.id, index, chunk),
    );
    if (usesVectors) {
      deleteKnowledgeVectors(db, oldChunkIds);
      vectors?.forEach((vector, index) => {
        const chunkId = newChunkIds[index];
        if (chunkId !== undefined) {
          insertKnowledgeVector(db, chunkId, vector);
        }
      });
    }
    updateKnowledgeIndex(db, { id: entry.id, contentHash, embeddingStatus: status, now });
  })();

  return status;
}

export function isMissingKnowledgeFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/** 整库重建:默认只处理哈希变化的条目;文件缺失留给外部编辑扫描标记删除 */
export async function rebuildKnowledgeIndex(
  db: Db,
  options: KnowledgeIndexOptions,
): Promise<KnowledgeRebuildResult> {
  const result: KnowledgeRebuildResult = { indexed: 0, skipped: 0, failed: 0, missing: 0 };
  for (const entry of listIndexableEntries(db)) {
    try {
      const outcome = await indexKnowledgeEntry(db, entry, options);
      if (outcome === "skipped") {
        result.skipped += 1;
      } else if (outcome === "failed") {
        result.failed += 1;
      } else {
        result.indexed += 1;
      }
    } catch (error) {
      if (isMissingKnowledgeFile(error)) {
        result.missing += 1;
        continue;
      }
      result.failed += 1;
      updateKnowledgeIndex(db, {
        id: entry.id,
        contentHash: entry.contentHash,
        embeddingStatus: "failed",
        now: (options.now ?? Date.now)(),
      });
    }
  }
  return result;
}
