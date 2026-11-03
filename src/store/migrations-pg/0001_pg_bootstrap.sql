-- agent-workbench PostgreSQL 合并基线(2026-11-03 重基线,02 全篇)。
-- greenfield:本文件是全部表结构的唯一来源,由 0001~0018 SQLite 迁移的终态合并而来。
-- epoch ms 一律 BIGINT;JSON 列以 TEXT 存储并以 ::jsonb 校验合法性(保持字符串进/出);
-- 追加式审计以触发器拒 UPDATE/DELETE;scope_revision 以触发器维护投影水位。

-- ============================================================ 任务域
CREATE TABLE task (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  assigner TEXT NOT NULL,
  assignee TEXT NOT NULL,
  project TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1 CHECK (round >= 1),
  rework_count INTEGER NOT NULL DEFAULT 0 CHECK (rework_count >= 0),
  stage TEXT NOT NULL CHECK (stage IN ('intake', 'plan', 'exec', 'review', 'deliver', 'closed')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'blocked', 'review', 'done', 'cancelled')),
  origin TEXT NOT NULL CHECK (origin IN ('feishu', 'a2a')),
  deadline_at BIGINT,
  output TEXT,
  started_at BIGINT,
  ended_at BIGINT,
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  parent_task_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX idx_task_status_deadline ON task (status, deadline_at);
CREATE INDEX idx_task_project_status ON task (project, status);
CREATE INDEX idx_task_parent ON task (parent_task_id);

CREATE TABLE task_event (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task (id) ON DELETE RESTRICT,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind TEXT NOT NULL CHECK (kind IN (
    'created', 'stage_changed', 'handoff', 'blocked', 'resumed', 'rework', 'completed', 'failed'
  )),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (payload_json::jsonb IS NOT NULL),
  occurred_at BIGINT NOT NULL,
  UNIQUE (task_id, seq)
);

-- ============================================================ 控制台凭据与会话
CREATE TABLE console_credential (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX idx_session_expires ON session (expires_at);

CREATE TABLE login_failure (
  source TEXT PRIMARY KEY,
  failures INTEGER NOT NULL CHECK (failures >= 1),
  locked_until BIGINT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE idempotency_record (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE TABLE scope_revision (
  scope TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at BIGINT NOT NULL
);

-- ============================================================ 飞书域
CREATE TABLE feishu_event (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at BIGINT NOT NULL
);

CREATE INDEX idx_feishu_event_received ON feishu_event (received_at);

CREATE TABLE feishu_command (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  open_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  command TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('handled', 'unsupported', 'invalid')),
  reply_text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_feishu_command_created ON feishu_command (created_at);

-- ============================================================ 授权域
CREATE TABLE capability (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  target TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'write', 'exec')),
  scope_json TEXT NOT NULL DEFAULT '{}' CHECK (scope_json::jsonb IS NOT NULL),
  ttl_seconds INTEGER NOT NULL DEFAULT 900 CHECK (ttl_seconds > 0 AND ttl_seconds <= 14400),
  status TEXT NOT NULL CHECK (status IN ('pending', 'issuing', 'active', 'expired', 'revoked', 'rejected')),
  ticket_id TEXT,
  task_id TEXT NOT NULL REFERENCES task (id) ON DELETE RESTRICT,
  issued_at BIGINT,
  expires_at BIGINT,
  revoked_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX idx_capability_status_created ON capability (status, created_at);
CREATE INDEX idx_capability_task ON capability (task_id);
CREATE INDEX idx_capability_ticket ON capability (ticket_id);

CREATE TABLE capability_audit (
  id BIGSERIAL PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES capability (id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'requested', 'approved', 'rejected', 'issued', 'issue_failed', 'expired', 'revoked', 'reconciled'
  )),
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (detail_json::jsonb IS NOT NULL),
  occurred_at BIGINT NOT NULL
);

CREATE INDEX idx_capability_audit_cap ON capability_audit (capability_id, occurred_at);

CREATE TABLE tool_call_log (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES task (id) ON DELETE RESTRICT,
  tool TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('L0', 'L1', 'L2')),
  verdict TEXT NOT NULL CHECK (verdict IN ('allow', 'deny', 'require_approval')),
  reason TEXT,
  capability_id TEXT REFERENCES capability (id) ON DELETE SET NULL,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  occurred_at BIGINT NOT NULL
);

CREATE INDEX idx_tool_call_log_task ON tool_call_log (task_id, occurred_at);
CREATE INDEX idx_tool_call_log_capability ON tool_call_log (capability_id);

-- 追加式审计:UPDATE/DELETE 一律拒绝。保留期清理必须新增迁移显式移除触发器并留评审记录。
CREATE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 为 append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER capability_audit_no_update BEFORE UPDATE ON capability_audit
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER capability_audit_no_delete BEFORE DELETE ON capability_audit
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER tool_call_log_no_update BEFORE UPDATE ON tool_call_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER tool_call_log_no_delete BEFORE DELETE ON tool_call_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ============================================================ 发件箱
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'pull')),
  delivery_class TEXT NOT NULL CHECK (delivery_class IN ('business', 'notification')),
  task_id TEXT,
  msg_id TEXT,
  kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (payload_json::jsonb IS NOT NULL),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'claimed', 'sending', 'retry_wait', 'delivered', 'failed', 'uncertain'
  )),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token INTEGER NOT NULL DEFAULT 0,
  lease_until BIGINT,
  available_at BIGINT NOT NULL,
  last_error TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_outbox_status_available ON outbox (status, available_at);
CREATE INDEX idx_outbox_msg_id ON outbox (msg_id);

-- ============================================================ 审计对账
CREATE TABLE audit_reconcile_gap (
  id BIGSERIAL PRIMARY KEY,
  dedup_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('missing_session', 'ticket_mismatch', 'orphan_session')),
  tool_call_log_id INTEGER REFERENCES tool_call_log (id) ON DELETE SET NULL,
  capability_id TEXT REFERENCES capability (id) ON DELETE SET NULL,
  task_id TEXT,
  ticket_id TEXT,
  sid TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (detail_json::jsonb IS NOT NULL),
  detected_at BIGINT NOT NULL
);

CREATE INDEX idx_audit_gap_kind_detected ON audit_reconcile_gap (kind, detected_at);
CREATE INDEX idx_audit_gap_ticket ON audit_reconcile_gap (ticket_id);

CREATE TRIGGER audit_reconcile_gap_no_update BEFORE UPDATE ON audit_reconcile_gap
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_reconcile_gap_no_delete BEFORE DELETE ON audit_reconcile_gap
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ============================================================ 身份域
CREATE TABLE machine (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  os TEXT NOT NULL,
  collector_version TEXT NOT NULL,
  collector_secret_hash TEXT NOT NULL,
  last_seen_at BIGINT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_machine_status ON machine (status);

CREATE TABLE agent (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machine (id) ON DELETE RESTRICT,
  project TEXT NOT NULL,
  display_name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  feishu_app_id TEXT,
  feishu_bot_open_id TEXT,
  feishu_bot_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  allowed_targets_json TEXT NOT NULL DEFAULT '[]' CHECK (allowed_targets_json::jsonb IS NOT NULL),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (machine_id, project)
);

CREATE INDEX idx_agent_machine ON agent (machine_id);
CREATE INDEX idx_agent_project ON agent (project);

-- ============================================================ A2A 域
CREATE TABLE a2a_thread (
  id TEXT PRIMARY KEY,
  initiator_task_id TEXT NOT NULL REFERENCES task (id) ON DELETE RESTRICT,
  initiator_agent TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  responder_agent TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  created_at BIGINT NOT NULL,
  UNIQUE (initiator_task_id, responder_agent)
);

CREATE INDEX idx_a2a_thread_initiator ON a2a_thread (initiator_task_id);

CREATE TABLE a2a_message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES a2a_thread (id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL REFERENCES task (id) ON DELETE RESTRICT,
  round INTEGER NOT NULL CHECK (round >= 1),
  reply_to_msg_id TEXT REFERENCES a2a_message (id) ON DELETE RESTRICT,
  from_agent TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  to_agent TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  intent TEXT NOT NULL CHECK (intent IN ('request', 'reply', 'notify', 'escalate')),
  summary TEXT NOT NULL,
  expect TEXT NOT NULL,
  deadline_at BIGINT,
  refs_json TEXT NOT NULL DEFAULT '[]' CHECK (refs_json::jsonb IS NOT NULL),
  auth_ticket TEXT,
  ack_at BIGINT,
  created_at BIGINT NOT NULL,
  UNIQUE (thread_id, round)
);

CREATE INDEX idx_a2a_message_thread_round ON a2a_message (thread_id, round);
CREATE INDEX idx_a2a_message_to_ack ON a2a_message (to_agent, ack_at);
CREATE INDEX idx_a2a_message_task ON a2a_message (task_id);

CREATE TABLE a2a_dead_letter (
  id TEXT PRIMARY KEY,
  msg_id TEXT NOT NULL REFERENCES a2a_message (id) ON DELETE RESTRICT,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  task_id TEXT,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (payload_json::jsonb IS NOT NULL),
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_a2a_dead_letter_msg ON a2a_dead_letter (msg_id);

-- ============================================================ 运行域
CREATE TABLE agent_run (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  machine TEXT NOT NULL REFERENCES machine (id) ON DELETE RESTRICT,
  project TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  task_id TEXT REFERENCES task (id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ended')),
  started_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  ended_at BIGINT,
  CHECK (last_seen_at >= started_at),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (
    (status = 'running' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_agent_run_running_stream
  ON agent_run (agent_id, stream_id) WHERE status = 'running';

CREATE INDEX idx_agent_run_agent_seen ON agent_run (agent_id, status, last_seen_at);
CREATE INDEX idx_agent_run_task ON agent_run (task_id);

CREATE TABLE timeline_event (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_run (id) ON DELETE RESTRICT,
  turn_id TEXT,
  block_id TEXT,
  ord INTEGER NOT NULL CHECK (ord >= 1),
  block_rev INTEGER NOT NULL DEFAULT 1 CHECK (block_rev >= 1),
  "offset" INTEGER CHECK ("offset" IS NULL OR "offset" >= 0),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (payload_json::jsonb IS NOT NULL),
  occurred_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX idx_timeline_event_turn_ord
  ON timeline_event (run_id, turn_id, ord);
CREATE INDEX idx_timeline_event_run_occurred ON timeline_event (run_id, occurred_at);
CREATE INDEX idx_timeline_event_block ON timeline_event (run_id, block_id, block_rev);

-- ============================================================ token 域
CREATE TABLE token_usage (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES task (id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES agent_run (id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_creation_tokens >= 0),
  source TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  receipt_hash TEXT NOT NULL,
  occurred_at BIGINT NOT NULL,
  UNIQUE (agent_id, run_id, source, sequence)
);

CREATE INDEX idx_token_usage_task ON token_usage (task_id, occurred_at);
CREATE INDEX idx_token_usage_agent_time ON token_usage (agent_id, occurred_at);

-- ============================================================ 采集去重
CREATE TABLE ingest_receipt (
  collector_id TEXT NOT NULL REFERENCES machine (id) ON DELETE RESTRICT,
  stream_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  received_at BIGINT NOT NULL,
  PRIMARY KEY (collector_id, stream_id, seq)
);

CREATE INDEX idx_ingest_receipt_received ON ingest_receipt (received_at);

-- ============================================================ 知识域
CREATE TABLE knowledge_entry (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'candidate', 'active', 'archived')),
  source_task_id TEXT REFERENCES task (id) ON DELETE RESTRICT,
  source_agent_id TEXT REFERENCES agent (id) ON DELETE RESTRICT,
  content_hash TEXT,
  embedding_status TEXT NOT NULL DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'ready', 'failed')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);

CREATE INDEX idx_knowledge_entry_status_updated ON knowledge_entry (status, updated_at);
CREATE INDEX idx_knowledge_entry_source_task ON knowledge_entry (source_task_id);
CREATE INDEX idx_knowledge_entry_source_agent ON knowledge_entry (source_agent_id);
CREATE INDEX idx_knowledge_entry_embedding ON knowledge_entry (embedding_status);

CREATE TABLE knowledge_chunk (
  id BIGSERIAL PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES knowledge_entry (id) ON DELETE CASCADE,
  chunk_no INTEGER NOT NULL CHECK (chunk_no >= 0),
  content TEXT NOT NULL,
  UNIQUE (entry_id, chunk_no)
);

CREATE INDEX idx_knowledge_chunk_entry ON knowledge_chunk (entry_id, chunk_no);

-- 关键词检索走 pg_trgm(trigram 支持中文子串 ≥3 字,1~2 字由检索层回退 LIKE);
-- 向量检索走 pgvector(语义维度不固定,列不带 typmod)。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX idx_knowledge_chunk_trgm ON knowledge_chunk USING gin (content gin_trgm_ops);

CREATE TABLE knowledge_vec (
  chunk_id INTEGER PRIMARY KEY REFERENCES knowledge_chunk (id) ON DELETE CASCADE,
  embedding vector
);

-- ============================================================ 投影水位触发器(scope_revision)
CREATE FUNCTION bump_scope_revision(scope_name TEXT) RETURNS void AS $$
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES (scope_name, 1, (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT)
  ON CONFLICT (scope) DO UPDATE SET revision = scope_revision.revision + 1, updated_at = excluded.updated_at;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION scope_revision_agent_ai() RETURNS trigger AS $$
BEGIN PERFORM bump_scope_revision('overview'); RETURN NULL; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_agent_ai AFTER INSERT ON agent
  FOR EACH ROW EXECUTE FUNCTION scope_revision_agent_ai();

CREATE FUNCTION scope_revision_agent_au() RETURNS trigger AS $$
BEGIN PERFORM bump_scope_revision('overview'); RETURN NULL; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_agent_au AFTER UPDATE ON agent
  FOR EACH ROW EXECUTE FUNCTION scope_revision_agent_au();

CREATE FUNCTION scope_revision_agent_run_ai() RETURNS trigger AS $$
BEGIN PERFORM bump_scope_revision('overview'); RETURN NULL; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_agent_run_ai AFTER INSERT ON agent_run
  FOR EACH ROW EXECUTE FUNCTION scope_revision_agent_run_ai();

CREATE FUNCTION scope_revision_agent_run_au() RETURNS trigger AS $$
BEGIN PERFORM bump_scope_revision('overview'); RETURN NULL; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_agent_run_au AFTER UPDATE ON agent_run
  FOR EACH ROW EXECUTE FUNCTION scope_revision_agent_run_au();

CREATE FUNCTION scope_revision_machine_au() RETURNS trigger AS $$
BEGIN PERFORM bump_scope_revision('overview'); RETURN NULL; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_machine_au AFTER UPDATE ON machine
  FOR EACH ROW EXECUTE FUNCTION scope_revision_machine_au();

CREATE FUNCTION scope_revision_token_usage_ai() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('overview');
  IF NEW.task_id IS NOT NULL THEN PERFORM bump_scope_revision('task:' || NEW.task_id); END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_token_usage_ai AFTER INSERT ON token_usage
  FOR EACH ROW EXECUTE FUNCTION scope_revision_token_usage_ai();

CREATE FUNCTION scope_revision_capability_ai() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('overview');
  PERFORM bump_scope_revision('task:' || NEW.task_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_capability_ai AFTER INSERT ON capability
  FOR EACH ROW EXECUTE FUNCTION scope_revision_capability_ai();

CREATE FUNCTION scope_revision_capability_au() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('overview');
  PERFORM bump_scope_revision('task:' || NEW.task_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_capability_au AFTER UPDATE ON capability
  FOR EACH ROW EXECUTE FUNCTION scope_revision_capability_au();

CREATE FUNCTION scope_revision_task_ai() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('overview');
  PERFORM bump_scope_revision('task:' || NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_task_ai AFTER INSERT ON task
  FOR EACH ROW EXECUTE FUNCTION scope_revision_task_ai();

CREATE FUNCTION scope_revision_task_au() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('overview');
  PERFORM bump_scope_revision('task:' || NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_task_au AFTER UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION scope_revision_task_au();

CREATE FUNCTION scope_revision_task_event_ai() RETURNS trigger AS $$
BEGIN PERFORM bump_scope_revision('task:' || NEW.task_id); RETURN NULL; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_task_event_ai AFTER INSERT ON task_event
  FOR EACH ROW EXECUTE FUNCTION scope_revision_task_event_ai();

CREATE FUNCTION scope_revision_a2a_message_ai() RETURNS trigger AS $$
BEGIN PERFORM bump_scope_revision('task:' || NEW.task_id); RETURN NULL; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_a2a_message_ai AFTER INSERT ON a2a_message
  FOR EACH ROW EXECUTE FUNCTION scope_revision_a2a_message_ai();

CREATE FUNCTION scope_revision_a2a_message_ack() RETURNS trigger AS $$
BEGIN
  IF NEW.ack_at IS DISTINCT FROM OLD.ack_at THEN
    PERFORM bump_scope_revision('task:' || NEW.task_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_a2a_message_ack AFTER UPDATE OF ack_at ON a2a_message
  FOR EACH ROW EXECUTE FUNCTION scope_revision_a2a_message_ack();
