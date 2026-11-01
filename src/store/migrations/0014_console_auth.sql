-- 控制台登录加固(M3-2):失败计数按来源落库,进程重启不丢锁;
-- 幂等键落库,跨重启仍返回首次结果,取代进程内 Map。
CREATE TABLE login_failure (
  source TEXT PRIMARY KEY,
  failures INTEGER NOT NULL CHECK (failures >= 1),
  locked_until INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE idempotency_record (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, key)
);
