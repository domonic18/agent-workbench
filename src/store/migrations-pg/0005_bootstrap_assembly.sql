-- 0005_bootstrap_assembly: 首次使用第 4 步的默认 bug_fix 装配记录(arch/01 §4、arch/03 §4.0)
-- 装配只绑定主责 Agent 与采纳的 work_kind,定义本体随仓库源码版本化(bootstrap/assembly.ts);
-- 预检失败不落此表,机器保持未就绪且不创建任何派工副作用。

CREATE TABLE bootstrap_assembly (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  primary_agent_id TEXT NOT NULL REFERENCES agent(id),
  work_kind TEXT NOT NULL CHECK (work_kind <> ''),
  assembled_at BIGINT NOT NULL CHECK (assembled_at > 0)
);
