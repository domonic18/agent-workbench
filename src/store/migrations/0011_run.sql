-- 运行域(02 §3.2):agent_run 是 run 末态投影,timeline_event 是 append-only 事件流。
-- run 身份 = (agent_id, stream_id):stream 是采集器的一条逻辑流(一个会话文件),
-- 同 Agent 多进程并存时各流各成一段 run,不合并(04 §4)。
CREATE TABLE agent_run (
  id TEXT PRIMARY KEY,                    -- run_<hex>
  agent_id TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  machine TEXT NOT NULL REFERENCES machine (id) ON DELETE RESTRICT, -- = collector_id
  project TEXT NOT NULL,                  -- cc-connect 项目名
  stream_id TEXT NOT NULL,                -- 采集器逻辑流,一个会话文件一条
  task_id TEXT REFERENCES task (id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ended')),
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ended_at INTEGER,
  CHECK (last_seen_at >= started_at),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (
    (status = 'running' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);

-- 一个流的当前 run 至多一条:30 分钟切分与进程退出都靠这条约束兜底
CREATE UNIQUE INDEX idx_agent_run_running_stream
  ON agent_run (agent_id, stream_id) WHERE status = 'running';

CREATE INDEX idx_agent_run_agent_seen ON agent_run (agent_id, status, last_seen_at);
CREATE INDEX idx_agent_run_task ON agent_run (task_id);

-- 四维坐标:block_id 身份、ord 块内顺序、block_rev 块内新鲜度、offset 增量位置。
-- kind 是采集契约的开放事件类型(04 §4),不用 CHECK 收死;occurred_at 供 run 边界判定。
CREATE TABLE timeline_event (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_run (id) ON DELETE RESTRICT,
  turn_id TEXT,
  block_id TEXT,
  ord INTEGER NOT NULL CHECK (ord >= 1),
  block_rev INTEGER NOT NULL DEFAULT 1 CHECK (block_rev >= 1),
  "offset" INTEGER CHECK ("offset" IS NULL OR "offset" >= 0),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  occurred_at INTEGER NOT NULL
);

-- 同一 turn 内 ord 唯一且递增(02 §3.2);turn_id 为空的 run 级事件不参与该约束
CREATE UNIQUE INDEX idx_timeline_event_turn_ord
  ON timeline_event (run_id, turn_id, ord);
CREATE INDEX idx_timeline_event_run_occurred ON timeline_event (run_id, occurred_at);
CREATE INDEX idx_timeline_event_block ON timeline_event (run_id, block_id, block_rev);
