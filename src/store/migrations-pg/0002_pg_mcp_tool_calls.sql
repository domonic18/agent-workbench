-- M3.8-3 Stage 1:控制台远程 /mcp 直接落 tool_call_log,调用不经执行机 run。
-- run_id NULL = 远程 MCP 调用(无 run 上下文);task_id NULL = 无任务只读工具(kb.search 检索审计)。
-- 采集回填的调用仍带 run_id 与 task_id,行为不变。
ALTER TABLE tool_call_log ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE tool_call_log ALTER COLUMN task_id DROP NOT NULL;
-- 审批通道移除(M3.8-3 闸门收敛),verdict 收敛为 allow/deny;
-- 0001 已发布不可改写,此处收敛约束,新库与旧库最终一致。
ALTER TABLE tool_call_log DROP CONSTRAINT tool_call_log_verdict_check;
ALTER TABLE tool_call_log
  ADD CONSTRAINT tool_call_log_verdict_check CHECK (verdict IN ('allow', 'deny'));
