-- 遥测保留与用量聚合(2026-11-17):采集事件类数据必须有界,用量明细要可长期对账。
--
-- 背景:采集端曾按 sessionId 记单条断点,同一会话 uuid 的多份副本(换工作区、
-- 跨目录续接都会产生)互相顶替 inode,每轮扫描都被判成文件轮转 → 断点归零 →
-- 整份文件重读重推,服务端因流 id 变化无法去重,一亿量级重复事件把库撑到 124GB。
-- 修复分三层:采集端按物理文件记断点(不再飞轮);服务端本迁移给遥测补「入库时间」
-- 并建立用量日聚合;保留任务按窗口滚动清理。
--
-- ingested_at:事件落库时刻。保留窗口必须按它算——按 occurred_at(事件发生时刻)
-- 会让「旧事件新入库」逃逸出保留窗口;存量行没有入库时刻,退而用 occurred_at。

ALTER TABLE timeline_event ADD COLUMN ingested_at BIGINT;
UPDATE timeline_event SET ingested_at = occurred_at WHERE ingested_at IS NULL;
ALTER TABLE timeline_event ALTER COLUMN ingested_at SET NOT NULL;
ALTER TABLE timeline_event ALTER COLUMN ingested_at SET DEFAULT 0;
CREATE INDEX idx_timeline_event_ingested ON timeline_event (ingested_at);

-- sequence 拓宽为 BIGINT:seq = 行首字节偏移 × 100,会话文件超过 21MB 就会溢出 int4,
-- 用量明细会被当毒丸丢弃(实测存量会话最大 86MB)
ALTER TABLE token_usage ALTER COLUMN sequence TYPE BIGINT;

-- 用量日聚合:token_usage 明细按窗口删除后,长期口径从这里读。
-- task_id 空串=非任务级用量;PK 含 task_id 保证老任务的用量汇总不随明细删除消失。
CREATE TABLE token_usage_daily (
  agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  day TEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
  entries BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (agent_id, task_id, source, provider, model, day)
);

-- 冷热合并视图:聚合表(冷,只含已聚合的整天) UNION 明细表(热,只含聚合水位之后)。
-- 水位 = 聚合表最大日 + 1 天(UTC 零点):水位之前的明细必然已聚合,计入冷侧;
-- 之后(含聚合任务两次运行之间迟到的旧明细)计入热侧,不重复计数。
-- 迟到早于水位的明细在下一轮聚合前对视图不可见,聚合后自愈——用量是统计口径,可接受。
-- 日表量纲存 BIGINT 防溢出,但视图侧转回 INTEGER:UNION 不转会把 int4 提升成 int8,
-- SUM(int8) 返回 numeric,读侧的数字口径会漂移成字符串。
CREATE VIEW token_usage_all AS
SELECT agent_id, task_id, '' AS run_id, source, provider, model,
       input_tokens::INTEGER, output_tokens::INTEGER,
       cache_read_tokens::INTEGER, cache_creation_tokens::INTEGER,
       entries::INTEGER,
       (day::date - DATE '1970-01-01') * 86400000::BIGINT AS occurred_at
  FROM token_usage_daily
UNION ALL
SELECT agent_id, COALESCE(task_id, '') AS task_id, run_id, source, provider, model,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
       1 AS entries,
       occurred_at
  FROM token_usage
 WHERE occurred_at >= COALESCE(
         (SELECT (MAX(day)::date + 1 - DATE '1970-01-01') * 86400000::BIGINT FROM token_usage_daily),
         0
       );
