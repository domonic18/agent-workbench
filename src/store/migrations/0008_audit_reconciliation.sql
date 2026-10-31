-- 审计对账缺口(05 §7):tool_call_log → capability(ticket_id) → Teleport session.start。
-- 链路上对不上的地方逐条落库,append-only;重跑靠 dedup_key 幂等,不重复记缺口。
CREATE TABLE audit_reconcile_gap (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('missing_session', 'ticket_mismatch', 'orphan_session')),
  tool_call_log_id INTEGER REFERENCES tool_call_log (id) ON DELETE SET NULL,
  capability_id TEXT REFERENCES capability (id) ON DELETE SET NULL,
  task_id TEXT,
  ticket_id TEXT,
  sid TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  detected_at INTEGER NOT NULL
);

CREATE INDEX idx_audit_gap_kind_detected ON audit_reconcile_gap (kind, detected_at);
CREATE INDEX idx_audit_gap_ticket ON audit_reconcile_gap (ticket_id);

-- 缺口是历史结论:发现即留档,不允许事后改写或删除来「抹平」。
CREATE TRIGGER audit_reconcile_gap_no_update BEFORE UPDATE ON audit_reconcile_gap
BEGIN
  SELECT RAISE(ABORT, 'audit_reconcile_gap 为 append-only');
END;

CREATE TRIGGER audit_reconcile_gap_no_delete BEFORE DELETE ON audit_reconcile_gap
BEGIN
  SELECT RAISE(ABORT, 'audit_reconcile_gap 为 append-only');
END;
