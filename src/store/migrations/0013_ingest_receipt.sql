-- 采集去重(02 §3.8 / 04 §4):按 (collector_id, stream_id, seq) 吸收重放,保留 7 天。
-- 只留末条挡不住乱序重放,故每条事件一行,按 received_at 滚动清理。
CREATE TABLE ingest_receipt (
  collector_id TEXT NOT NULL REFERENCES machine (id) ON DELETE RESTRICT,
  stream_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  received_at INTEGER NOT NULL,
  PRIMARY KEY (collector_id, stream_id, seq)
);

CREATE INDEX idx_ingest_receipt_received ON ingest_receipt (received_at);
