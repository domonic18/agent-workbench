import { getLoadablePath } from "sqlite-vec";
import { KNOWLEDGE_INDEX } from "../../shared/constants.js";
import type { Db } from "../database.js";

/** 同一个连接只加载一次扩展;失败直接抛,由调用方决定降级 */
const loaded = new WeakSet<Db>();

export function ensureKnowledgeVectorTable(db: Db): void {
  if (!loaded.has(db)) {
    db.loadExtension(getLoadablePath());
    loaded.add(db);
  }
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(embedding float[${KNOWLEDGE_INDEX.dimensions}])`,
  );
}

/**
 * vec0 的主键只收整数,而 better-sqlite3 默认把 JS number 绑成 REAL,
 * 必须显式 CAST,否则报「Only integers are allows for primary key values」。
 */
export function insertKnowledgeVector(db: Db, chunkId: number, embedding: Float32Array): void {
  db.prepare(
    "INSERT INTO knowledge_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)",
  ).run(chunkId, embedding);
}

export function deleteKnowledgeVectors(db: Db, chunkIds: readonly number[]): void {
  if (chunkIds.length === 0) {
    return;
  }
  const stmt = db.prepare("DELETE FROM knowledge_vec WHERE rowid = CAST(? AS INTEGER)");
  for (const chunkId of chunkIds) {
    stmt.run(chunkId);
  }
}
