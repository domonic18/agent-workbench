-- 心跳活跃流(04 §2 三层信号之 L2):机器在心跳里上报「自上一跳以来有新字节的流」,
-- 控制台据此豁免这些流上 running run 的 L3 兜底收敛——机器仍在观测到写入,不是孤儿。
-- JSONB 数组,每跳整包覆盖(未上报即落 '[]'),不给降级机器留永久豁免。
ALTER TABLE machine ADD COLUMN active_streams JSONB NOT NULL DEFAULT '[]'::jsonb;
