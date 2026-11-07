-- M3.8-3 第二刀:一次性令牌(01 §2 / 04 §密钥)。
-- bootstrap_admin(设置管理员)与 enroll(执行机加入)两类,库中只存 SHA-256 定位哈希;
-- 令牌为 256 位随机量,明文只在签发/兑换响应出现一次,不写日志。
CREATE TABLE one_time_token (
  token_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('bootstrap_admin', 'enroll')),
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_one_time_token_purpose ON one_time_token (purpose);
