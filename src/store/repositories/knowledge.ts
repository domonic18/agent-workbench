import type {
  KnowledgeEmbeddingStatus,
  KnowledgeStatus,
} from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface KnowledgeEntryRecord {
  id: string;
  path: string;
  title: string;
  summary: string;
  category: string;
  status: KnowledgeStatus;
  sourceTaskId: string | null;
  sourceAgentId: string | null;
  contentHash: string | null;
  embeddingStatus: KnowledgeEmbeddingStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

const COLUMNS = `
  id, path, title, summary, category, status,
  source_task_id AS sourceTaskId, source_agent_id AS sourceAgentId,
  content_hash AS contentHash, embedding_status AS embeddingStatus,
  created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
`;

export interface NewKnowledgeEntry {
  id: string;
  path: string;
  title: string;
  summary: string;
  category: string;
  status: KnowledgeStatus;
  sourceTaskId: string | null;
  sourceAgentId: string | null;
  createdAt: number;
}

export function insertKnowledgeEntry(db: Db, row: NewKnowledgeEntry): void {
  db.prepare(
    `INSERT INTO knowledge_entry
       (id, path, title, summary, category, status, source_task_id, source_agent_id, created_at, updated_at)
     VALUES (@id, @path, @title, @summary, @category, @status, @sourceTaskId, @sourceAgentId, @createdAt, @createdAt)`,
  ).run(row);
}

export function findKnowledgeEntry(db: Db, id: string): KnowledgeEntryRecord | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM knowledge_entry WHERE id = ?`).get(id) as
    | KnowledgeEntryRecord
    | undefined;
}

export function findKnowledgeEntryByPath(
  db: Db,
  path: string,
): KnowledgeEntryRecord | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM knowledge_entry WHERE path = ?`).get(path) as
    | KnowledgeEntryRecord
    | undefined;
}

/** 索引只处理未删除条目;archived 仍保留索引,恢复后无需重建 */
export function listIndexableEntries(db: Db): KnowledgeEntryRecord[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM knowledge_entry WHERE deleted_at IS NULL ORDER BY id`)
    .all() as KnowledgeEntryRecord[];
}

export interface KnowledgeIndexUpdate {
  id: string;
  contentHash: string | null;
  embeddingStatus: KnowledgeEmbeddingStatus;
  now: number;
}

export function updateKnowledgeIndex(db: Db, input: KnowledgeIndexUpdate): void {
  db.prepare(
    `UPDATE knowledge_entry
        SET content_hash = @contentHash, embedding_status = @embeddingStatus, updated_at = @now
      WHERE id = @id`,
  ).run(input);
}

export interface KnowledgeChunkRecord {
  id: number;
  entryId: string;
  chunkNo: number;
  content: string;
}

export function insertKnowledgeChunk(
  db: Db,
  entryId: string,
  chunkNo: number,
  content: string,
): number {
  const result = db
    .prepare("INSERT INTO knowledge_chunk (entry_id, chunk_no, content) VALUES (?, ?, ?)")
    .run(entryId, chunkNo, content);
  return Number(result.lastInsertRowid);
}

export function deleteKnowledgeChunks(db: Db, entryId: string): void {
  db.prepare("DELETE FROM knowledge_chunk WHERE entry_id = ?").run(entryId);
}

export function listKnowledgeChunkIds(db: Db, entryId: string): number[] {
  const rows = db
    .prepare("SELECT id FROM knowledge_chunk WHERE entry_id = ? ORDER BY chunk_no")
    .all(entryId) as { id: number }[];
  return rows.map((row) => row.id);
}

export function listKnowledgeChunks(db: Db, entryId: string): KnowledgeChunkRecord[] {
  return db
    .prepare(
      `SELECT id, entry_id AS entryId, chunk_no AS chunkNo, content
         FROM knowledge_chunk WHERE entry_id = ? ORDER BY chunk_no`,
    )
    .all(entryId) as KnowledgeChunkRecord[];
}
