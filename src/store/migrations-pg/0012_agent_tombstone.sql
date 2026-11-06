-- Agent 硬删除的墓碑与投影水位补齐(arch/01 Agent 生命周期):
-- 1) agent_tombstone 保留被删 Agent 的名字。task.assignee / task.assigner /
--    tool_call_log.agent_id 是纯文本列,Agent 行删掉后只剩裸 id,墓碑是它们
--    显示「已删除 Agent X」的依据;
-- 2) 既有 scope_revision 触发器只覆盖 INSERT/UPDATE。删 Agent 不推水位,
--    SSE 客户端的 Agent 列表会停在旧快照——此处补 AFTER DELETE 触发器。

CREATE TABLE agent_tombstone (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  project TEXT NOT NULL,
  machine_id TEXT,
  runtime TEXT NOT NULL,
  deleted_at BIGINT NOT NULL
);

CREATE INDEX idx_agent_tombstone_deleted ON agent_tombstone (deleted_at DESC);

CREATE FUNCTION scope_revision_agent_ad() RETURNS trigger AS $$
BEGIN PERFORM bump_scope_revision('overview'); RETURN NULL; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_agent_ad AFTER DELETE ON agent
  FOR EACH ROW EXECUTE FUNCTION scope_revision_agent_ad();

CREATE FUNCTION scope_revision_token_usage_ad() RETURNS trigger AS $$
BEGIN
  PERFORM bump_scope_revision('overview');
  IF OLD.task_id IS NOT NULL THEN PERFORM bump_scope_revision('task:' || OLD.task_id); END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_token_usage_ad AFTER DELETE ON token_usage
  FOR EACH ROW EXECUTE FUNCTION scope_revision_token_usage_ad();

CREATE FUNCTION scope_revision_a2a_message_ad() RETURNS trigger AS $$
BEGIN PERFORM bump_scope_revision('task:' || OLD.task_id); RETURN NULL; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scope_revision_a2a_message_ad AFTER DELETE ON a2a_message
  FOR EACH ROW EXECUTE FUNCTION scope_revision_a2a_message_ad();
