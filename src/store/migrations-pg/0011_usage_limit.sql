CREATE TABLE usage_limit (
  agent_id TEXT PRIMARY KEY REFERENCES agent(id) ON DELETE CASCADE,
  daily_token_limit BIGINT NOT NULL CHECK (daily_token_limit >= 0),
  warn_percent INTEGER NOT NULL CHECK (warn_percent >= 0 AND warn_percent <= 100),
  hard_stop BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at BIGINT NOT NULL
);
