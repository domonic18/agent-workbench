-- 0004_bootstrap_delivery: 首次使用自动装配的发现上报与配置下发(arch/01 §4、arch/02 §3)
-- machine.discovery_json 保存 aw-node 上报的 cc-connect 发现结果,config_status 表示
-- 配置待下发/已下发/已生效;agent 侧 key 是 Git 项目注册表引用的稳定键,
-- secret_hash 允空——项目确认时只建身份,秘密改由 /api/aw-node/config 在 ACK 前轮换签发。

ALTER TABLE machine
  ADD COLUMN discovery_json TEXT,
  ADD COLUMN discovery_received_at BIGINT,
  ADD COLUMN config_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (config_status IN ('pending', 'delivered', 'effective'));

ALTER TABLE agent
  ALTER COLUMN secret_hash DROP NOT NULL,
  ADD COLUMN key TEXT,
  ADD COLUMN mcp_config_json TEXT,
  ADD COLUMN config_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN config_ack_at BIGINT,
  ADD COLUMN bootstrap_status TEXT NOT NULL DEFAULT 'registered'
    CHECK (bootstrap_status IN ('confirmed', 'registered'));

-- confirmed:bootstrap 项目确认创建,密钥只经 /api/aw-node/config 在 ACK 前轮换签发;
-- registered:人工注册,密钥在注册响应出现一次,不参与配置下发轮换。

CREATE UNIQUE INDEX idx_agent_key ON agent (key) WHERE key IS NOT NULL;
