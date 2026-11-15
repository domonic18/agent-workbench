-- 委派目标组(2026-11-14):把「谁能被某个 Agent 委派」按组收口。
--
-- 组只回答委派可达性——A 把 G 列为收件方 = A 能发给 G 的所有成员;
-- 不参与派工、能力签发与任何其它判定,避免长成第二个真相源。
-- 委派白名单(agent.allowed_targets_json)里可以放 Agent id,也可以放组 id。
CREATE TABLE agent_group (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE agent_group_member (
  group_id TEXT NOT NULL REFERENCES agent_group(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, agent_id)
);

CREATE INDEX agent_group_member_agent_idx ON agent_group_member (agent_id);
