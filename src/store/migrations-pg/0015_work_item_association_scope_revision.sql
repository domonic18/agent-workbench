-- ============================================================ 0015 关联表挂上事项作用域
-- 0014 给 work_item / work_item_event 建了水位触发器,关联三张表只补了 UPDATE。
-- 但「新任务挂到事项上」「新派工落到事项上」「新执行开始」都是 INSERT,
-- 只在 UPDATE 时才动水位,抽屉会一直看不到新关联的行。
--
-- 规则(task / agent_run / worker_inbox):
--   INSERT → 事项作用域
--   UPDATE → 事项作用域;换绑时旧事项与新事项都动,别让旧事项挂着过期投影

DROP TRIGGER IF EXISTS scope_revision_task_work_item_au ON task;
DROP TRIGGER IF EXISTS scope_revision_agent_run_work_item_au ON agent_run;
DROP TRIGGER IF EXISTS scope_revision_worker_inbox_au ON worker_inbox;
DROP FUNCTION IF EXISTS scope_revision_task_work_item_au();
DROP FUNCTION IF EXISTS scope_revision_agent_run_work_item_au();
DROP FUNCTION IF EXISTS scope_revision_worker_inbox_au();

CREATE FUNCTION scope_revision_task_work_item_ai() RETURNS trigger AS $$
BEGIN
  IF NEW.work_item_id IS NOT NULL THEN
    PERFORM bump_scope_revision('work_item:' || NEW.work_item_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_task_work_item_ai AFTER INSERT ON task
  FOR EACH ROW EXECUTE FUNCTION scope_revision_task_work_item_ai();

CREATE FUNCTION scope_revision_task_work_item_au() RETURNS trigger AS $$
BEGIN
  IF OLD.work_item_id IS NOT NULL THEN
    PERFORM bump_scope_revision('work_item:' || OLD.work_item_id);
  END IF;
  IF NEW.work_item_id IS NOT NULL THEN
    PERFORM bump_scope_revision('work_item:' || NEW.work_item_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_task_work_item_au AFTER UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION scope_revision_task_work_item_au();

CREATE FUNCTION scope_revision_agent_run_work_item_ai() RETURNS trigger AS $$
BEGIN
  IF NEW.work_item_id IS NOT NULL THEN
    PERFORM bump_scope_revision('work_item:' || NEW.work_item_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_agent_run_work_item_ai AFTER INSERT ON agent_run
  FOR EACH ROW EXECUTE FUNCTION scope_revision_agent_run_work_item_ai();

CREATE FUNCTION scope_revision_agent_run_work_item_au() RETURNS trigger AS $$
BEGIN
  IF OLD.work_item_id IS NOT NULL THEN
    PERFORM bump_scope_revision('work_item:' || OLD.work_item_id);
  END IF;
  IF NEW.work_item_id IS NOT NULL THEN
    PERFORM bump_scope_revision('work_item:' || NEW.work_item_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_agent_run_work_item_au AFTER UPDATE ON agent_run
  FOR EACH ROW EXECUTE FUNCTION scope_revision_agent_run_work_item_au();

CREATE FUNCTION scope_revision_worker_inbox_ai() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('work_item:' || NEW.work_item_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_worker_inbox_ai AFTER INSERT ON worker_inbox
  FOR EACH ROW EXECUTE FUNCTION scope_revision_worker_inbox_ai();

CREATE FUNCTION scope_revision_worker_inbox_au() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('work_item:' || OLD.work_item_id);
  PERFORM bump_scope_revision('work_item:' || NEW.work_item_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_worker_inbox_au AFTER UPDATE ON worker_inbox
  FOR EACH ROW EXECUTE FUNCTION scope_revision_worker_inbox_au();
