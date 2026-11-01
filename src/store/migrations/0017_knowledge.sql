-- 知识域(02 §3.5):knowledge_entry 只是便于查询与展示的元数据镜像,正文在 Markdown 文件。
-- 分块与向量索引(knowledge_chunk / knowledge_vec / FTS)随 M3.5-4 另建,可整库重建。
CREATE TABLE knowledge_entry (
  id TEXT PRIMARY KEY,               -- 服务端生成 kb_<hex>
  path TEXT NOT NULL UNIQUE,         -- 相对知识目录的 Markdown 路径
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'candidate', 'active', 'archived')),
  source_task_id TEXT REFERENCES task (id) ON DELETE RESTRICT,
  source_agent_id TEXT REFERENCES agent (id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_knowledge_entry_status_updated ON knowledge_entry (status, updated_at);
CREATE INDEX idx_knowledge_entry_source_task ON knowledge_entry (source_task_id);
CREATE INDEX idx_knowledge_entry_source_agent ON knowledge_entry (source_agent_id);
