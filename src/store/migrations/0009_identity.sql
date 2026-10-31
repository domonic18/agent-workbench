-- 身份域(02 §3.7 / 01 §4):machine = 采集器登记,agent = Agent 运行时身份。
-- 两套密钥各自独立哈希存放;明文只在注册那一刻返回给调用方,库中永不留明文。
CREATE TABLE machine (
  id TEXT PRIMARY KEY,               -- = collector_id,控制台自填("macmini-01")
  hostname TEXT NOT NULL,
  os TEXT NOT NULL,
  collector_version TEXT NOT NULL,
  collector_secret_hash TEXT NOT NULL,
  last_seen_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_machine_status ON machine (status);

CREATE TABLE agent (
  id TEXT PRIMARY KEY,               -- 服务端生成 agt_<hex>
  machine_id TEXT NOT NULL REFERENCES machine (id) ON DELETE RESTRICT,
  project TEXT NOT NULL,
  display_name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  feishu_app_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  allowed_targets_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_targets_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (machine_id, project)
);

CREATE INDEX idx_agent_machine ON agent (machine_id);
CREATE INDEX idx_agent_project ON agent (project);
