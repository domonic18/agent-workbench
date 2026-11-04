-- 机器无关(machine-less)Agent:无 aw-node 的外部运行时(WorkBuddy/Codex/DeepSeek harness)
-- 直接拿 Agent Bearer 打 /mcp,控制台不采集其 run/对话/Token(03 §4.0 / M3.8-3 task)。
-- 行为判别只看 machine_id 是否为 NULL;runtime 是允许列表式的分类标签,新增运行时只改本迁移 + shared 常量。

ALTER TABLE agent ALTER COLUMN machine_id DROP NOT NULL;

ALTER TABLE agent ADD COLUMN runtime TEXT NOT NULL DEFAULT 'claude_code'
  CHECK (runtime IN ('claude_code', 'workbuddy', 'codex', 'deepseek'));

-- 唯一约束只在「机器绑定」维度生效;机器无关 Agent 按 id 唯一,不强行项目去重
ALTER TABLE agent DROP CONSTRAINT agent_machine_id_project_key;

CREATE UNIQUE INDEX agent_machine_project_key
  ON agent (machine_id, project) WHERE machine_id IS NOT NULL;
