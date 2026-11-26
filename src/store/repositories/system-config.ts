import type { Db } from "../database.js";

export interface SystemConfigRecord {
  key: string;
  value: string;
  updatedAt: number;
  updatedBy: string;
}

/** 全量读取(≤13 行单表,调用方直读不缓存);列表值存逗号分隔 TEXT,由上层解析 */
export async function readSystemConfig(db: Db): Promise<Record<string, string>> {
  const rows = (await db.all(
    'SELECT key, value FROM system_config',
  )) as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/** 携带元数据的读取:设置页回显「最近修改」用 */
export async function readSystemConfigEntries(db: Db): Promise<SystemConfigRecord[]> {
  return (await db.all(
    'SELECT key, value, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM system_config ORDER BY key',
  )) as SystemConfigRecord[];
}

/** upsert 单事务;updatedBy 记录变更者(单管理员当前固定 admin) */
export async function writeSystemConfig(
  db: Db,
  entries: { key: string; value: string }[],
  updatedAt: number,
  updatedBy: string,
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  await db.transaction(async (tx) => {
    for (const entry of entries) {
      await tx.run(
        `INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        entry.key, entry.value, updatedAt, updatedBy,
      );
    }
  });
}
