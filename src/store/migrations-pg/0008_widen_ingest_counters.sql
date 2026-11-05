-- ============================================================ 0008 采集计数放大
-- 采集器 seq 空间按文件字节偏移编码(collector scan.ts: seq = startOffset*100 + i + 1),
-- 会话日志超过 ~21.5MB 后 seq 越过 int4 上限,ingest 以 22003 整批失败(2026-11-05
-- 真实链路触发)。凡承载采集侧 seq/offset 的列一律 BIGINT;服务端自生成的
-- task_event.seq / work_item_event.seq(每行 MAX+1)仍为 INTEGER,不放大。

ALTER TABLE ingest_receipt ALTER COLUMN seq TYPE BIGINT;
ALTER TABLE token_usage ALTER COLUMN sequence TYPE BIGINT;
ALTER TABLE timeline_event ALTER COLUMN ord TYPE BIGINT;
ALTER TABLE timeline_event ALTER COLUMN "offset" TYPE BIGINT;
