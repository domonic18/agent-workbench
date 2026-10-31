-- 指令审计(02 §3.8):白名单用户每条入站指令的解析与回执结果
-- feishu_event 只做 7 天去重,不放审计;这里长期保留,便于回答「为什么回不支持」
CREATE TABLE feishu_command (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  open_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  command TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('handled', 'unsupported', 'invalid')),
  reply_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_feishu_command_created ON feishu_command (created_at);
