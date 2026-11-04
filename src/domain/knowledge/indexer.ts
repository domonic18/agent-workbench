import { readFile } from "node:fs/promises";
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
  insertKnowledgeVector,
} from "../../store/repositories/knowledge-vector.js";
import { splitMarkdown } from "./chunk.js";
import type { EmbeddingClient } from "./embedding.js";
import { hashKnowledgeContent } from "./hash.js";
import { resolveEntryPath } from "./paths.js";

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
 * 单条重建:先算哈希与嵌入(异步),再在一个事务内替换分块、关键词索引与向量,
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

  const status: KnowledgeEmbeddingStatus = embeddingFailed
    ? "failed"
    : vectors === undefined
      ? "pending"
      : "ready";
  const now = (options.now ?? Date.now)();
  // 曾嵌入成功的条目即使本轮拿不到向量,也要先清旧向量,保持「状态=库里事实」一致
  const usesVectors = vectors !== undefined || entry.embeddingStatus === "ready";

  await db.transaction(async (tx) => {
    const oldChunkIds = await listKnowledgeChunkIds(tx, entry.id);
    await deleteKnowledgeChunks(tx, entry.id);
    const newChunkIds: number[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      newChunkIds.push(await insertKnowledgeChunk(tx, entry.id, index, chunks[index] ?? ""));
    }
    if (usesVectors) {
      await deleteKnowledgeVectors(tx, oldChunkIds);
    }
    if (vectors !== undefined) {
      for (let index = 0; index < vectors.length; index += 1) {
        const chunkId = newChunkIds[index];
        const vector = vectors[index];
        if (chunkId !== undefined && vector !== undefined) {
          await insertKnowledgeVector(tx, chunkId, vector);
        }
      }
    }
    await updateKnowledgeIndex(tx, { id: entry.id, contentHash, embeddingStatus: status, now });
  });

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
  for (const entry of await listIndexableEntries(db)) {
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
      await updateKnowledgeIndex(db, {
        id: entry.id,
        contentHash: entry.contentHash,
        embeddingStatus: "failed",
        now: (options.now ?? Date.now)(),
      });
    }
  }
  return result;
}
