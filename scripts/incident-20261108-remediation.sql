-- M3.10-1 事故善后（一次性运维，2026-11-08 并行派工事故 + 僵尸残留）
-- 前置：./scripts/backup.sh --verify 已通过；控制台正在运行（本脚本只改状态，不发事件）
-- 语义：blocked 不伪造 ended_at；cancelled 是「从未开工」的诚实终态；重派由闸门放行后的正常派发轮承担
BEGIN;

-- 1) 卡 running 的僵尸 task → blocked（ended_at 留空，待重派换新任务收口）
--    5 行：tsk_c1132…（A2A 任务，11-05 起僵死，无事项）+ 11-08 事故 4 行
UPDATE task SET status = 'blocked'
WHERE id IN (
  'tsk_c1132af0c74527f9',
  'tsk_51e1d0ac9649edee',
  'tsk_6a5ca49b584a5413',
  'tsk_581db170300ff1b7',
  'tsk_c9cf5387434886bf'
) AND status = 'running';

-- 2) 事故批次孤儿 assignment（acked 但无活 worker）→ pending 重置
--    清租约（lease_token 回 0、lease_until 置空）与承接任务指针（task_id 置空，重派后由新 ack 重绑）
--    10 行：11-08 18:56 事故批次
UPDATE worker_inbox
SET status = 'pending', lease_token = 0, lease_until = NULL, task_id = NULL
WHERE id IN (
  'wib_2d26fad9d4072b32', 'wib_ce1e17964253d9aa', 'wib_5a9fafae040652c7', 'wib_c552738199c17a82',
  'wib_ec600f6f5f75d0d6', 'wib_51586569d2d22b1a', 'wib_f6226e3c1581909a', 'wib_bc1969f6ba5a1c42',
  'wib_35bf3c5f17276a02', 'wib_53de540c8e80f1ad'
) AND status = 'acked';

-- 3) 事故批次从未开工的承接任务（pending@intake，会话被杀）→ cancelled
--    留 pending 会与新重派任务并存成永久孤儿；cancelled + ended_at 是诚实终态
--    6 行
UPDATE task
SET status = 'cancelled', ended_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
WHERE id IN (
  'tsk_9273b599f3260470', 'tsk_d0e64d040c4e76ac', 'tsk_07b59972d05e1a74',
  'tsk_a68bdeee7fae6366', 'tsk_2605150824186229', 'tsk_ad5e4da5d2eba371'
) AND status = 'pending';

-- 4) stalled 事项回流转：attention → none（status 不动，重派后自然推进）
--    7 行
UPDATE work_item SET attention = 'none' WHERE attention = 'stalled' AND status = 'open';

-- 5) 已删测试 Agent 级联残留的孤儿 open 事项（无 assignment 行，永不流转）→ cancelled
--    deleteAgentCascade 删 worker_inbox 行但留 open 事项（代码缺口，批次 4 修：删除 Agent 时
--    同事务取消其 open 事项，不再产生此类孤儿）
--    16 行
UPDATE work_item
SET status = 'cancelled', ended_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
WHERE status = 'open'
  AND NOT EXISTS (SELECT 1 FROM worker_inbox wib WHERE wib.work_item_id = work_item.id);

COMMIT;

-- 验收断言（执行后期望行数）：
--   SELECT count(*) FROM task WHERE status='running';            -- 0
--   SELECT count(*) FROM worker_inbox WHERE status='pending';    -- 10
--   SELECT count(*) FROM work_item WHERE attention='stalled';    -- 0
--   SELECT count(*) FROM work_item WHERE status='open'
--     AND NOT EXISTS (SELECT 1 FROM worker_inbox w WHERE w.work_item_id = work_item.id);  -- 0
