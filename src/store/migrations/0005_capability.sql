-- 授权域(02 §3.4):capability 审批与凭证标识、审计、闸门判定日志。
-- subject / agent_id 暂不加外键:agent 域(M2.5)尚无表,登记校验由服务层做。
CREATE TABLE capability (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  target TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'write', 'exec')),
  scope_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scope_json)),
  ttl_seconds INTEGER NOT NULL DEFAULT 900 CHECK (ttl_seconds > 0 AND ttl_seconds <= 14400),
  status TEXT NOT NULL CHECK (status IN ('pending', 'issuing', 'active', 'expired', 'revoked', 'rejected')),
  ticket_id TEXT,
  task_id TEXT NOT NULL REFERENCES task (id) ON DELETE RESTRICT,
  issued_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_capability_status_created ON capability (status, created_at);
CREATE INDEX idx_capability_task ON capability (task_id);
CREATE INDEX idx_capability_ticket ON capability (ticket_id);

CREATE TABLE capability_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capability_id TEXT NOT NULL REFERENCES capability (id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'requested', 'approved', 'rejected', 'issued', 'issue_failed', 'expired', 'revoked', 'reconciled'
  )),
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  occurred_at INTEGER NOT NULL
);

CREATE INDEX idx_capability_audit_cap ON capability_audit (capability_id, occurred_at);

CREATE TABLE tool_call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  occurred_at INTEGER NOT NULL
);

CREATE INDEX idx_tool_call_log_task ON tool_call_log (task_id, occurred_at);
CREATE INDEX idx_tool_call_log_capability ON tool_call_log (capability_id);

-- 审计 append-only:UPDATE/DELETE 一律中止。保留期清理若真需要删数据(如 tool_call_log
-- 180 天),必须新增迁移显式移除触发器并留评审记录,不允许运行期作业静默改写历史。
CREATE TRIGGER capability_audit_no_update BEFORE UPDATE ON capability_audit
BEGIN
  SELECT RAISE(ABORT, 'capability_audit 为 append-only');
END;

CREATE TRIGGER capability_audit_no_delete BEFORE DELETE ON capability_audit
BEGIN
  SELECT RAISE(ABORT, 'capability_audit 为 append-only');
END;

CREATE TRIGGER tool_call_log_no_update BEFORE UPDATE ON tool_call_log
BEGIN
  SELECT RAISE(ABORT, 'tool_call_log 为 append-only');
END;

CREATE TRIGGER tool_call_log_no_delete BEFORE DELETE ON tool_call_log
BEGIN
  SELECT RAISE(ABORT, 'tool_call_log 为 append-only');
END;
