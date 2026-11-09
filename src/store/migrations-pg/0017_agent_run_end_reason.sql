-- run 收尾原因(02 §3.2):让「为什么结束」可解释、可统计。
-- 三值对应三层收尾路径(04 §2):idle_split=惰性切分(新事件到达时回看)、
-- process_exit=进程退出宣告(M2 由 aw-node 接线)、orphan_swept=L3 兜底收敛作业。
-- 存量 ended 行保持 NULL,不伪造历史原因。
ALTER TABLE agent_run ADD COLUMN end_reason TEXT;

ALTER TABLE agent_run
  ADD CONSTRAINT agent_run_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN ('idle_split', 'process_exit', 'orphan_swept'));

-- L3 兜底作业每轮扫 running 且 last_seen 超阈值的行;部分索引只覆盖 running 行,
-- 随历史 run 增长不膨胀。
CREATE INDEX idx_agent_run_stale_sweep
  ON agent_run (last_seen_at) WHERE status = 'running';
