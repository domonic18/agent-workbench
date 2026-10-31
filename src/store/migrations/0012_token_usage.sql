-- token 域(02 §3.6):用量事实 append-only,四维分列,不存金额与价表版本。
-- 幂等键 (agent_id, run_id, source, sequence);同键不同 receipt_hash 由服务层报冲突。
CREATE TABLE token_usage (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES task (id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES agent_run (id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,                    -- 上报原文,不做别名归一
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_creation_tokens >= 0),
  source TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  receipt_hash TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  UNIQUE (agent_id, run_id, source, sequence)
);

CREATE INDEX idx_token_usage_task ON token_usage (task_id, occurred_at);
CREATE INDEX idx_token_usage_agent_time ON token_usage (agent_id, occurred_at);
