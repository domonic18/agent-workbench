import type { Db } from "../database.js";

/**
 * pgvector 以文本形式绑定:`[0.1,0.2,...]` 由 vector 输入函数解析;
 * 表与扩展由 0001 迁移建好,这里只管写入与清理。
 */
export async function insertKnowledgeVector(
  db: Db,
  chunkId: number,
  embedding: Float32Array,
): Promise<void> {
  const literal = `[${Array.from(embedding).join(",")}]`;
  await db.run(
    "INSERT INTO knowledge_vec (chunk_id, embedding) VALUES (?, ?)",
    chunkId, literal,
  );
}

export async function deleteKnowledgeVectors(db: Db, chunkIds: readonly number[]): Promise<void> {
  if (chunkIds.length === 0) {
    return;
  }
  await db.run("DELETE FROM knowledge_vec WHERE chunk_id = ANY(?::int[])", [...chunkIds]);
}
