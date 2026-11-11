-- 派发状态(M3.11):机器在心跳里捎带被挡项目的挂起原因,控制台据此透出
-- 「有活派不出去」并驱动 auth_stale 自愈。JSONB 数组整包覆盖,未上报即落 '[]',
-- 不给降级机器留永久挂起徽标。
ALTER TABLE machine ADD COLUMN dispatch_status JSONB NOT NULL DEFAULT '[]'::jsonb;
