-- 读模型投影版本(02 §4):每个作用域一行,SSE 帧携带该值用于检测缺口。
-- 用触发器而非服务层显式递增:revision 是「投影表变了」的派生水位,
-- 触发器保证任何写入路径都不会漏记;revision 只增不减,每作用域独立。
CREATE TABLE scope_revision (
  scope TEXT PRIMARY KEY,             -- overview | task:<id>
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL
);

-- overview:Agent 注册表、运行末态、任务末态、用量、审批的变化都会影响五项指标。
CREATE TRIGGER scope_revision_agent_insert AFTER INSERT ON agent
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('overview', 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER scope_revision_agent_update AFTER UPDATE ON agent
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('overview', 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER scope_revision_agent_run_insert AFTER INSERT ON agent_run
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('overview', 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER scope_revision_agent_run_update AFTER UPDATE ON agent_run
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('overview', 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

-- 心跳:只更新 machine.last_seen_at,但「心跳超时」指标随之变化。
CREATE TRIGGER scope_revision_machine_update AFTER UPDATE ON machine
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('overview', 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER scope_revision_token_usage_insert AFTER INSERT ON token_usage
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('overview', 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

-- token 已归属任务时,任务详情的 token 汇总也变化。
CREATE TRIGGER scope_revision_token_usage_task AFTER INSERT ON token_usage
WHEN NEW.task_id IS NOT NULL
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('task:' || NEW.task_id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER scope_revision_capability_insert AFTER INSERT ON capability
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('overview', 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('task:' || NEW.task_id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER scope_revision_capability_update AFTER UPDATE ON capability
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('overview', 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('task:' || NEW.task_id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

-- 任务行本身与任务时间线各自推进 task:<id>;任务行同时影响 overview 指标。
CREATE TRIGGER scope_revision_task_insert AFTER INSERT ON task
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('overview', 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('task:' || NEW.id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER scope_revision_task_update AFTER UPDATE ON task
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('overview', 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('task:' || NEW.id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER scope_revision_task_event_insert AFTER INSERT ON task_event
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('task:' || NEW.task_id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

-- A2A 往返影响任务详情的线程与面包屑;ACK 也走这条。
CREATE TRIGGER scope_revision_a2a_message_insert AFTER INSERT ON a2a_message
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('task:' || NEW.task_id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER scope_revision_a2a_message_ack AFTER UPDATE OF ack_at ON a2a_message
BEGIN
  INSERT INTO scope_revision (scope, revision, updated_at)
  VALUES ('task:' || NEW.task_id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
END;
