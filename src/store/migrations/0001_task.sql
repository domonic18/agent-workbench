-- 任务域首个迁移(02 §3.1):task 行 + 任务时间线 task_event
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
  origin TEXT NOT NULL CHECK (origin IN ('feishu', 'console', 'a2a')),
  deadline_at INTEGER,
  output TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  cost_nanousd INTEGER NOT NULL DEFAULT 0 CHECK (cost_nanousd >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_task_status_deadline ON task (status, deadline_at);
CREATE INDEX idx_task_project_status ON task (project, status);

CREATE TABLE task_event (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task (id) ON DELETE RESTRICT,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind TEXT NOT NULL CHECK (kind IN (
    'created', 'stage_changed', 'handoff', 'blocked', 'resumed', 'rework', 'completed', 'failed'
  )),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  occurred_at INTEGER NOT NULL,
  UNIQUE (task_id, seq)
);
