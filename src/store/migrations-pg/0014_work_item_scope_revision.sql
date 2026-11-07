-- ============================================================ 0014 工作事项投影水位
-- arch/02 §4 已把 work_item:<id> 列为合法作用域(与 overview / task:<id> 并列),
-- 但 0001 的 scope_revision 触发器只覆盖 agent / agent_run / machine / token_usage /
-- capability / task / task_event / a2a_message,工作事项这一族从未被纳入。
-- 结果:工作事项详情订阅不到增量,总览也拿不到工作事项的水位。
--
-- 触发规则:
--   work_item        投影本身变了 → 事项作用域 + overview(总览区块要跟着刷新)
--   work_item_event  追加了事件   → 只动事项作用域
--                    (domain/work/decision.ts 追加 input 事件时不碰 work_item 投影,
--                     只有事件表能感知这类进展)
--   worker_inbox     派工状态变了   → 事项作用域(等待对象由 inbox 推导)
--   task / agent_run 关联变了     → 事项作用域(关联工作块由这两张表组装)

CREATE FUNCTION scope_revision_work_item_ai() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('work_item:' || NEW.id);
  PERFORM bump_scope_revision('overview');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_work_item_ai AFTER INSERT ON work_item
  FOR EACH ROW EXECUTE FUNCTION scope_revision_work_item_ai();

CREATE FUNCTION scope_revision_work_item_au() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('work_item:' || NEW.id);
  PERFORM bump_scope_revision('overview');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_work_item_au AFTER UPDATE ON work_item
  FOR EACH ROW EXECUTE FUNCTION scope_revision_work_item_au();

CREATE FUNCTION scope_revision_work_item_event_ai() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('work_item:' || NEW.work_item_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_work_item_event_ai AFTER INSERT ON work_item_event
  FOR EACH ROW EXECUTE FUNCTION scope_revision_work_item_event_ai();

CREATE FUNCTION scope_revision_worker_inbox_au() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('work_item:' || NEW.work_item_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_worker_inbox_au AFTER UPDATE ON worker_inbox
  FOR EACH ROW EXECUTE FUNCTION scope_revision_worker_inbox_au();

CREATE FUNCTION scope_revision_task_work_item_au() RETURNS trigger AS $$
BEGIN
  IF NEW.work_item_id IS NOT NULL THEN
    PERFORM bump_scope_revision('work_item:' || NEW.work_item_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_task_work_item_au AFTER UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION scope_revision_task_work_item_au();

CREATE FUNCTION scope_revision_agent_run_work_item_au() RETURNS trigger AS $$
BEGIN
  IF NEW.work_item_id IS NOT NULL THEN
    PERFORM bump_scope_revision('work_item:' || NEW.work_item_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_agent_run_work_item_au AFTER UPDATE ON agent_run
  FOR EACH ROW EXECUTE FUNCTION scope_revision_agent_run_work_item_au();
