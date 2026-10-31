-- 控制台会话(01 §3 / 02 §3.8):只存服务端随机会话 id 与时间,不存口令或派生材料。
-- Cookie 仅承载 id;过期以库中 expires_at 为准,客户端时间不参与判定。
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_session_expires ON session (expires_at);
