-- Agent 自助接入令牌(01 §4):purpose 增加 agent_enroll,并用 subject_id 绑定目标 Agent。
-- 人签发、Agent 兑换;令牌明文只在签发与兑换各出现一次,库中只存 SHA-256 定位哈希。
-- 兑换时轮换该 Agent 的密钥,旧密钥立即失效——这样令牌过期不产生任何副作用。
ALTER TABLE one_time_token DROP CONSTRAINT one_time_token_purpose_check;

ALTER TABLE one_time_token ADD COLUMN subject_id TEXT;

ALTER TABLE one_time_token
  ADD CONSTRAINT one_time_token_purpose_check
  CHECK (purpose IN ('bootstrap_admin', 'enroll', 'agent_enroll'));
