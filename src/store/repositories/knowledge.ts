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

export function insertKnowledgeEntry(db: Db, row: NewKnowledgeEntry): Promise<void>{
  await db.run(``INSERT INTO knowledge_entry
       (id, path, title, summary, category, status, source_task_id, source_agent_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  ON CONFLICT DO NOTHING)`,`, row.id, row.path, row.title, row.summary, row.category, row.status, row.sourceTaskId, row.sourceAgentId, row.createdAt, row.createdAt);
}

export async function findKnowledgeEntry(db: Db, id: string): Promise<KnowledgeEntryRecord | undefined>{
  return await db.get(`SELECT ${COLUMNS} FROM knowledge_entry WHERE id = ?`, id) as
    | KnowledgeEntryRecord
    | undefined;
}

export async function findKnowledgeEntryByPath(
  db: Db,
  path: string,
): Promise<KnowledgeEntryRecord | undefined>{
  return await db.get(`SELECT ${COLUMNS} FROM knowledge_entry WHERE path = ?`, path) as
    | KnowledgeEntryRecord
    | undefined;
}

/** 索引只处理未删除条目;archived 仍保留索引,恢复后无需重建 */
export async function listIndexableEntries(db: Db): Promise<KnowledgeEntryRecord[]>{
  return await db.all(`SELECT ${COLUMNS} FROM knowledge_entry WHERE deleted_at IS NULL ORDER BY id`) as KnowledgeEntryRecord[];
}

export interface KnowledgeIndexUpdate {
  id: string;
  contentHash: string | null;
  embeddingStatus: KnowledgeEmbeddingStatus;
  now: number;
}

export function updateKnowledgeIndex(db: Db, input: KnowledgeIndexUpdate): Promise<void>{
  await db.run(``UPDATE knowledge_entry
        SET content_hash = ?, embedding_status = ?, updated_at = ?
      WHERE id = ?`,`, input.contentHash, input.embeddingStatus, input.now, input.id);
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

export function listKnowledgeEntries(db: Db, query: KnowledgeListQuery): Promise<KnowledgeEntryRecord[]>{
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
  return await db.all(``SELECT ${COLUMNS} FROM knowledge_entry
        WHERE ${conditions.join(" AND ")}
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`,`, params.limit) as KnowledgeEntryRecord[];
}

/** 页签角标:未删除条目按状态计数,缺省补 0 */
export function countKnowledgeEntriesByStatus(db: Db): Promise<KnowledgeStatusCounts>{
  const rows = await db.all(`SELECT status, COUNT(*) AS total FROM knowledge_entry
        WHERE deleted_at IS NULL GROUP BY status`,) as { status: KnowledgeStatus; total: number }[];
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
): Promise<boolean>{
  return (
    (await db.run(`UPDATE knowledge_entry SET status = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,, status, now, id)).changes === 1
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
export function updateKnowledgeEntryMeta(db: Db, input: KnowledgeMetaUpdate): Promise<boolean>{
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
    (await db.run(``UPDATE knowledge_entry SET ${sets.join(", ")}
          WHERE id = ? AND deleted_at IS NULL`,`, params.id)).changes === 1
  );
}

/** 文件被改写后作废旧哈希,列表据此显示 pending,直到单条重试或整库重建 */
export function invalidateKnowledgeIndex(db: Db, id: string, now: number): Promise<void>{
  await db.run(`UPDATE knowledge_entry
        SET content_hash = NULL, embedding_status = 'pending', updated_at = ?
      WHERE id = ?`,, now, id);
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
): Promise<number>{
  const result = await db.run("INSERT INTO knowledge_chunk (entry_id, chunk_no, content) VALUES (?, ?, ?)", entryId, chunkNo, content);
  return Number(result.lastInsertRowid);
}

export function deleteKnowledgeChunks(db: Db, entryId: string): Promise<void>{
  await db.run("DELETE FROM knowledge_chunk WHERE entry_id = ?", entryId);
}

export function listKnowledgeChunkIds(db: Db, entryId: string): Promise<number[]>{
  const rows = await db.all("SELECT id FROM knowledge_chunk WHERE entry_id = ? ORDER BY chunk_no", entryId) as { id: number }[];
  return rows.map((row) => row.id);
}

export function listKnowledgeChunks(db: Db, entryId: string): Promise<KnowledgeChunkRecord[]>{
  return await db.all(`SELECT id, entry_id AS entryId, chunk_no AS chunkNo, content
         FROM knowledge_chunk WHERE entry_id = ? ORDER BY chunk_no`,, entryId) as KnowledgeChunkRecord[];
}
