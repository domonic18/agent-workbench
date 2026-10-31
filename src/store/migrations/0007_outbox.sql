-- 发件箱(02 §3.4 / 01 §6):所有对外投递的运输状态机,只管运输不管业务内容。
-- 内容真相在 a2a_message / 飞书卡片 payload;重投复用同一行并累加 attempts,不新建记录。
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'pull')),
  delivery_class TEXT NOT NULL CHECK (delivery_class IN ('business', 'notification')),
  task_id TEXT,
  msg_id TEXT,
  kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'claimed', 'sending', 'retry_wait', 'delivered', 'failed', 'uncertain'
  )),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  available_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_outbox_status_available ON outbox (status, available_at);
