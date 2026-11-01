-- 知识索引链(02 §3.5):分块与 FTS 可整库重建;向量表在运行时加载 sqlite-vec 后
-- 单独创建,不进迁移——原生扩展不可用时控制台仍需启动并降级为仅关键词。
ALTER TABLE knowledge_entry ADD COLUMN content_hash TEXT;
ALTER TABLE knowledge_entry ADD COLUMN embedding_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (embedding_status IN ('pending', 'ready', 'failed'));

CREATE INDEX idx_knowledge_entry_embedding ON knowledge_entry (embedding_status);

CREATE TABLE knowledge_chunk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL REFERENCES knowledge_entry (id) ON DELETE CASCADE,
  chunk_no INTEGER NOT NULL CHECK (chunk_no >= 0),
  content TEXT NOT NULL,
  UNIQUE (entry_id, chunk_no)
);

CREATE INDEX idx_knowledge_chunk_entry ON knowledge_chunk (entry_id, chunk_no);

-- 关键词索引行号与 knowledge_chunk.id 对齐;trigram 支持中文子串(≥3 字),
-- 1~2 字查询由检索层回退 LIKE(unicode61 会把整段中文当成一个词)。
CREATE VIRTUAL TABLE knowledge_fts USING fts5(content, tokenize = 'trigram');

CREATE TRIGGER knowledge_chunk_ai AFTER INSERT ON knowledge_chunk BEGIN
  INSERT INTO knowledge_fts (rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER knowledge_chunk_ad AFTER DELETE ON knowledge_chunk BEGIN
  DELETE FROM knowledge_fts WHERE rowid = old.id;
END;

CREATE TRIGGER knowledge_chunk_au AFTER UPDATE ON knowledge_chunk BEGIN
  DELETE FROM knowledge_fts WHERE rowid = old.id;
  INSERT INTO knowledge_fts (rowid, content) VALUES (new.id, new.content);
END;
