import type { Db } from "../../store/database.js";

export interface KnowledgeHit {
  entryId: string;
  path: string;
  title: string;
  summary: string;
  /** 命中的分块正文;条目尚无分块时为 null,此时只有标题/摘要出处 */
  chunkNo: number | null;
  content: string | null;
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * 知识检索(kb.search,L0):只出 active 且未删除条目,命中带出处(entryId/path/chunkNo)。
 * 关键词索引(pg_trgm 加速的 LIKE)始终可读,不依赖嵌入状态(03 §4.4)。
 */
export async function searchKnowledge(
  db: Db,
  query: { search: string; limit?: number },
): Promise<KnowledgeHit[]> {
  const trimmed = query.search.trim();
  if (trimmed === "") {
    return [];
  }
  const limit = query.limit ?? 8;
  const pattern = likePattern(trimmed);

  // 先命中条目(标题/摘要),再命中分块正文;两路合并去重,条目命中排前
  const entries = await db.all(
    `SELECT id, path, title, summary
       FROM knowledge_entry
      WHERE deleted_at IS NULL AND status = 'active'
        AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')
      ORDER BY updated_at DESC, id DESC
      LIMIT ?`,
    pattern, pattern, limit,
  );
  const chunks = await db.all(
    `SELECT c.entry_id AS "entryId", c.chunk_no AS "chunkNo", c.content,
            e.path, e.title, e.summary
       FROM knowledge_chunk c
       JOIN knowledge_entry e ON e.id = c.entry_id
      WHERE e.deleted_at IS NULL AND e.status = 'active'
        AND c.content LIKE ? ESCAPE '\\'
      ORDER BY e.updated_at DESC, c.entry_id, c.chunk_no
      LIMIT ?`,
    pattern, limit,
  );

  const hits: KnowledgeHit[] = [];
  const seen = new Set<string>();
  for (const row of entries as Array<Record<string, unknown>>) {
    const id = String(row.id);
    hits.push({
      entryId: id,
      path: String(row.path),
      title: String(row.title),
      summary: String(row.summary ?? ""),
      chunkNo: null,
      content: null,
    });
    seen.add(id);
  }
  for (const row of chunks as Array<Record<string, unknown>>) {
    const id = String(row.entryId);
    if (!seen.has(id)) {
      hits.push({
        entryId: id,
        path: String(row.path),
        title: String(row.title),
        summary: String(row.summary ?? ""),
        chunkNo: Number(row.chunkNo),
        content: String(row.content),
      });
      seen.add(id);
    }
  }
  return hits.slice(0, limit);
}
