-- 定时任务快照:执行机(cc-connect)的周期任务与未触发的一次性延时任务。
-- 控制台只做只读观测,真相源在 cc-connect 侧;JSONB 数组整包覆盖,未上报即落 '[]'。
-- 敏感内容(prompt/exec/session_key)在采集端剔除,这里只存展示必需的元数据。
ALTER TABLE machine ADD COLUMN schedules JSONB NOT NULL DEFAULT '[]'::jsonb;
