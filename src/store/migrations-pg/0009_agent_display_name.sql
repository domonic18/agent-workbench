-- ============================================================ 0009 修正 Agent 显示名称为用户视角
-- 旧版 /setup 把 cc-connect 项目工作目录(cwd)写进了 agent.display_name,
-- 导致协作群卡片显示为文件路径。将其回退为项目名(project),
-- 后续 Agent 自报飞书 bot 名称后会优先使用 feishu_bot_name。

UPDATE agent
SET display_name = project,
    updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
WHERE display_name LIKE '/%'
  AND status = 'active';
