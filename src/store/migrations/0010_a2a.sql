-- A2A 传输层(02 §3.3 / 01 §5):内容表(a2a_message)与运输表(outbox)分家,
-- 线程按 (发起方任务, 收件方) 唯一;链路靠 task.parent_task_id 另一条边表达。
ALTER TABLE task ADD COLUMN parent_task_id TEXT;

CREATE INDEX idx_task_parent ON task (parent_task_id);

CREATE TABLE a2a_thread (
  id TEXT PRIMARY KEY,
  initiator_task_id TEXT NOT NULL REFERENCES task (id) ON DELETE RESTRICT,
  initiator_agent TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  responder_agent TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  UNIQUE (initiator_task_id, responder_agent)
);

CREATE INDEX idx_a2a_thread_initiator ON a2a_thread (initiator_task_id);

CREATE TABLE a2a_message (
  id TEXT PRIMARY KEY,               -- = msg_id,服务端生成
  thread_id TEXT NOT NULL REFERENCES a2a_thread (id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL REFERENCES task (id) ON DELETE RESTRICT,
  round INTEGER NOT NULL CHECK (round >= 1),
  reply_to_msg_id TEXT REFERENCES a2a_message (id) ON DELETE RESTRICT,
  from_agent TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  to_agent TEXT NOT NULL REFERENCES agent (id) ON DELETE RESTRICT,
  intent TEXT NOT NULL CHECK (intent IN ('request', 'reply', 'notify', 'escalate')),
  summary TEXT NOT NULL,
  expect TEXT NOT NULL,
  deadline_at INTEGER,
  refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(refs_json)),
  auth_ticket TEXT,
  ack_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (thread_id, round)
);

CREATE INDEX idx_a2a_message_thread_round ON a2a_message (thread_id, round);
CREATE INDEX idx_a2a_message_to_ack ON a2a_message (to_agent, ack_at);
CREATE INDEX idx_a2a_message_task ON a2a_message (task_id);

CREATE TABLE a2a_dead_letter (
  id TEXT PRIMARY KEY,
  msg_id TEXT NOT NULL REFERENCES a2a_message (id) ON DELETE RESTRICT,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  task_id TEXT,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_a2a_dead_letter_msg ON a2a_dead_letter (msg_id);

-- 信箱拉取按 msg_id 反查出箱行;ACK 与领取都走这条索引
CREATE INDEX idx_outbox_msg_id ON outbox (msg_id);
