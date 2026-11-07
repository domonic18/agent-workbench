-- ============================================================ 0013 机器显示名可改
-- 用户反馈:执行机登记时把 IP(192.168.1.244)当成了机器名,事后没有改名入口。
-- hostname 是 enroll / re-enroll 的去重键(findReusableMachine 按 hostname+os 复用行),
-- 改它会让重装后的机器在库里堆出新的机器行、丢掉已绑定的 Agent。
-- 因此新增独立的 display_name 列:初始回填 hostname,改名不影响去重与绑定。

ALTER TABLE machine ADD COLUMN display_name TEXT;

UPDATE machine SET display_name = hostname WHERE display_name IS NULL;

-- 列可空:历史行以外的直写场景(如工具脚本)不必带该列,读取侧统一回退 hostname
