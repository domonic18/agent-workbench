-- 工作协调域(arch/02 §3.9):work_item / work_item_event / work_trigger /
-- work_thread / thread_subscription / worker_inbox,并给 task 与 agent_run
-- 补 work_item_id 关联(创建时可关联、创建后不可改,代码层保证不改写)。
-- 循环引用(work_item.origin_trigger_id ↔ work_trigger.work_item_id)在表全部
-- 建完后统一 ADD CONSTRAINT。

-- ============================================================ 事项
CREATE TABLE work_item (
  id TEXT PRIMARY KEY,
  parent_work_item_id TEXT REFERENCES work_item (id) ON DELETE RESTRICT,
  project TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  expected_result TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}' CHECK (scope_json::jsonb IS NOT NULL),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  stage TEXT NOT NULL DEFAULT 'intake'
    CHECK (stage IN ('intake', 'align', 'execute', 'review', 'verify', 'release')),
  attention TEXT NOT NULL DEFAULT 'none'
    CHECK (attention IN ('none', 'person', 'blocked', 'acceptance', 'stalled')),
  origin_trigger_id TEXT,
  authorization_kind TEXT NOT NULL DEFAULT 'none',
  authorization_ref TEXT,
  policy_version TEXT NOT NULL,
  next_action TEXT,
  latest_summary TEXT,
  last_progress_at BIGINT,
  progress_revision INTEGER NOT NULL DEFAULT 0 CHECK (progress_revision >= 0),
  output TEXT,
  validation_json TEXT,
  acceptance_ref TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  ended_at BIGINT,
  CHECK (ended_at IS NULL OR ended_at >= created_at),
  CHECK (status = 'open' OR ended_at IS NOT NULL)
);

CREATE INDEX idx_work_item_project ON work_item (project, status);

CREATE TABLE work_item_event (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES work_item (id) ON DELETE RESTRICT,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind TEXT NOT NULL,
  trigger_id TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (evidence_refs_json::jsonb IS NOT NULL),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (payload_json::jsonb IS NOT NULL),
  occurred_at BIGINT NOT NULL,
  UNIQUE (work_item_id, seq)
);

-- ============================================================ 触发事实
CREATE TABLE work_trigger (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (actor_json::jsonb IS NOT NULL),
  project TEXT,
  thread_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (thread_refs_json::jsonb IS NOT NULL),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (payload_json::jsonb IS NOT NULL),
  refs_json TEXT NOT NULL DEFAULT '[]' CHECK (refs_json::jsonb IS NOT NULL),
  authorization_ref TEXT,
  disposition TEXT NOT NULL
    CHECK (disposition IN ('received', 'continued', 'routed', 'needs_person', 'ignored')),
  reason_code TEXT,
  rule_id TEXT,
  rule_version TEXT,
  work_item_id TEXT,
  target_agent_id TEXT REFERENCES agent (id) ON DELETE RESTRICT,
  occurred_at BIGINT NOT NULL,
  received_at BIGINT NOT NULL,
  UNIQUE (source, source_event_id)
);

CREATE INDEX idx_work_trigger_work_item ON work_trigger (work_item_id);

-- ============================================================ Thread 与订阅
CREATE TABLE work_thread (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_kind TEXT NOT NULL,
  external_key TEXT NOT NULL,
  project TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  last_trigger_at BIGINT,
  created_at BIGINT NOT NULL,
  UNIQUE (source, external_kind, external_key)
);

CREATE TABLE thread_subscription (
  id TEXT PRIMARY KEY,
  work_thread_id TEXT NOT NULL REFERENCES work_thread (id) ON DELETE RESTRICT,
  work_item_id TEXT NOT NULL REFERENCES work_item (id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES task (id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('owner', 'context')),
  created_by TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  revoked_at BIGINT,
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

-- 一个业务 Thread 至多一个有效 owner;context 订阅不产生执行权
CREATE UNIQUE INDEX thread_subscription_single_owner
  ON thread_subscription (work_thread_id) WHERE mode = 'owner' AND revoked_at IS NULL;

-- ============================================================ 派工信箱
CREATE TABLE worker_inbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('assignment', 'input')),
  work_item_id TEXT NOT NULL REFERENCES work_item (id) ON DELETE RESTRICT,
  trigger_id TEXT REFERENCES work_trigger (id) ON DELETE RESTRICT,
  target_agent_id TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES task (id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'acked', 'handed_back', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  lease_token INTEGER NOT NULL DEFAULT 0,
  lease_until BIGINT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (payload_json::jsonb IS NOT NULL),
  reason TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX idx_worker_inbox_target ON worker_inbox (target_agent_id, status);

-- ============================================================ 既有表关联
ALTER TABLE task ADD COLUMN work_item_id TEXT REFERENCES work_item (id) ON DELETE RESTRICT;
ALTER TABLE agent_run ADD COLUMN work_item_id TEXT REFERENCES work_item (id) ON DELETE RESTRICT;

-- origin 追加 work_item(arch/02 §3.2):由已归属业务事项承接而来的任务;
-- 没有 console——控制台不手动建单,Router 也不代替 Agent 建单
ALTER TABLE task DROP CONSTRAINT task_origin_check;
ALTER TABLE task ADD CONSTRAINT task_origin_check
  CHECK (origin IN ('feishu', 'a2a', 'work_item'));

CREATE INDEX idx_task_work_item ON task (work_item_id);
CREATE INDEX idx_agent_run_work_item ON agent_run (work_item_id);

-- 循环引用补齐
ALTER TABLE work_item ADD CONSTRAINT work_item_origin_trigger_fk
  FOREIGN KEY (origin_trigger_id) REFERENCES work_trigger (id) ON DELETE RESTRICT;
ALTER TABLE work_trigger ADD CONSTRAINT work_trigger_work_item_fk
  FOREIGN KEY (work_item_id) REFERENCES work_item (id) ON DELETE RESTRICT;
ALTER TABLE work_item_event ADD CONSTRAINT work_item_event_trigger_fk
  FOREIGN KEY (trigger_id) REFERENCES work_trigger (id) ON DELETE RESTRICT;
