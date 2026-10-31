-- 飞书入站事件去重(02 §3.8):同一 event_id 只处理一次
CREATE TABLE feishu_event (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX idx_feishu_event_received ON feishu_event (received_at);
