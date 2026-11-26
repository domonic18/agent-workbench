-- ============================================================ 后台运行时配置(2026-11-26 裁决:控制台运行时配置与凭据入库)
-- DB 无该行 = 回落 env 值(平滑迁移);有行且值为空串 = 显式清除。
-- 凭据类值库内明文(API 只写不读、日志不记值),备份将含凭据属已知取舍。
CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  updated_by TEXT NOT NULL
);
