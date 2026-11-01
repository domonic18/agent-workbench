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

/** 控制台列表:按状态分页,搜索标题 / 摘要 / 分块正文(关键词索引始终可读) */
export interface KnowledgeListQuery {
  status: KnowledgeStatus;
  search?: string;
  limit: number;
  /** 排序键为 (updated_at, id) 倒序;游标由调用方从上一页末行构造 */
  before?: { updatedAt: number; id: string };
}

export type KnowledgeStatusCounts = Record<KnowledgeStatus, number>;

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function listKnowledgeEntries(db: Db, query: KnowledgeListQuery): KnowledgeEntryRecord[] {
  const conditions = ["deleted_at IS NULL", "status = @status"];
  const params: Record<string, unknown> = { status: query.status, limit: query.limit };
  if (query.search !== undefined && query.search !== "") {
    conditions.push(
      `(title LIKE @pattern ESCAPE '\\'
        OR summary LIKE @pattern ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM knowledge_chunk chunk
           WHERE chunk.entry_id = knowledge_entry.id
             AND chunk.content LIKE @pattern ESCAPE '\\'
        ))`,
    );
    params.pattern = likePattern(query.search);
  }
  if (query.before !== undefined) {
    conditions.push("(updated_at < @beforeAt OR (updated_at = @beforeAt AND id < @beforeId))");
    params.beforeAt = query.before.updatedAt;
    params.beforeId = query.before.id;
  }
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM knowledge_entry
        WHERE ${conditions.join(" AND ")}
        ORDER BY updated_at DESC, id DESC
        LIMIT @limit`,
    )
    .all(params) as KnowledgeEntryRecord[];
}

/** 页签角标:未删除条目按状态计数,缺省补 0 */
export function countKnowledgeEntriesByStatus(db: Db): KnowledgeStatusCounts {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS total FROM knowledge_entry
        WHERE deleted_at IS NULL GROUP BY status`,
    )
    .all() as { status: KnowledgeStatus; total: number }[];
  const counts: KnowledgeStatusCounts = { draft: 0, candidate: 0, active: 0, archived: 0 };
  for (const row of rows) {
    counts[row.status] = row.total;
  }
  return counts;
}

export function updateKnowledgeEntryStatus(
  db: Db,
  id: string,
  status: KnowledgeStatus,
  now: number,
): boolean {
  return (
    db
      .prepare(
        `UPDATE knowledge_entry SET status = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(status, now, id).changes === 1
  );
}

export interface KnowledgeMetaUpdate {
  id: string;
  title?: string;
  summary?: string;
  category?: string;
  now: number;
}

/** 正文在文件里;这里只镜像展示字段,索引状态另由 invalidateKnowledgeIndex 作废 */
export function updateKnowledgeEntryMeta(db: Db, input: KnowledgeMetaUpdate): boolean {
  const sets = ["updated_at = @now"];
  const params: Record<string, unknown> = { id: input.id, now: input.now };
  if (input.title !== undefined) {
    sets.push("title = @title");
    params.title = input.title;
  }
  if (input.summary !== undefined) {
    sets.push("summary = @summary");
    params.summary = input.summary;
  }
  if (input.category !== undefined) {
    sets.push("category = @category");
    params.category = input.category;
  }
  return (
    db
      .prepare(
        `UPDATE knowledge_entry SET ${sets.join(", ")}
          WHERE id = @id AND deleted_at IS NULL`,
      )
      .run(params).changes === 1
  );
}

/** 文件被改写后作废旧哈希,列表据此显示 pending,直到单条重试或整库重建 */
export function invalidateKnowledgeIndex(db: Db, id: string, now: number): void {
  db.prepare(
    `UPDATE knowledge_entry
        SET content_hash = NULL, embedding_status = 'pending', updated_at = ?
      WHERE id = ?`,
  ).run(now, id);
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
