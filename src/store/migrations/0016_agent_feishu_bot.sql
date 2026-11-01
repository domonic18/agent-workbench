-- 飞书协作通知(M2.5-8):bot 身份由各 Agent 的 MCP proxy 启动时经 /bot/v3/info 自报并注册;
-- 控制台只存 open_id 与展示名用于渲染 <at>,不保存任何 Agent 的 App Secret。
ALTER TABLE agent ADD COLUMN feishu_bot_open_id TEXT;
ALTER TABLE agent ADD COLUMN feishu_bot_name TEXT;
