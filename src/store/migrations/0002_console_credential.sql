-- 控制台登录凭据(01 §3):单行,只存口令哈希,不存明文
CREATE TABLE console_credential (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
