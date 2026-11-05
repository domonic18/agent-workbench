import type { Db } from "../database.js";

export interface UsageLimitRecord {
  agentId: string;
  dailyTokenLimit: number;
  warnPercent: number;
  hardStop: boolean;
  isActive: boolean;
  updatedAt: number;
}

const COLUMNS = `
  agent_id AS "agentId",
  daily_token_limit AS "dailyTokenLimit",
  warn_percent AS "warnPercent",
  hard_stop AS "hardStop",
  is_active AS "isActive",
  updated_at AS "updatedAt"
`;

export interface NewUsageLimit {
  agentId: string;
  dailyTokenLimit: number;
  warnPercent: number;
  hardStop: boolean;
  isActive: boolean;
  updatedAt: number;
}

export async function findUsageLimitByAgentId(
  db: Db,
  agentId: string,
): Promise<UsageLimitRecord | undefined> {
  return (await db.get(
    `SELECT ${COLUMNS} FROM usage_limit WHERE agent_id = ?`,
    agentId,
  )) as UsageLimitRecord | undefined;
}

export async function findUsageLimitsByAgentIds(
  db: Db,
  agentIds: readonly string[],
): Promise<Map<string, UsageLimitRecord>> {
  if (agentIds.length === 0) {
    return new Map();
  }
  const placeholders = agentIds.map(() => "?").join(", ");
  const rows = (await db.all(
    `SELECT ${COLUMNS} FROM usage_limit WHERE agent_id IN (${placeholders})`,
    ...agentIds,
  )) as UsageLimitRecord[];
  return new Map(rows.map((row) => [row.agentId, row]));
}

export async function upsertUsageLimit(db: Db, row: NewUsageLimit): Promise<void> {
  await db.run(
    `INSERT INTO usage_limit
       (agent_id, daily_token_limit, warn_percent, hard_stop, is_active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (agent_id) DO UPDATE SET
       daily_token_limit = EXCLUDED.daily_token_limit,
       warn_percent = EXCLUDED.warn_percent,
       hard_stop = EXCLUDED.hard_stop,
       is_active = EXCLUDED.is_active,
       updated_at = EXCLUDED.updated_at`,
    row.agentId,
    row.dailyTokenLimit,
    row.warnPercent,
    row.hardStop,
    row.isActive,
    row.updatedAt,
  );
}

export async function deleteUsageLimit(db: Db, agentId: string): Promise<boolean> {
  return (await db.run("DELETE FROM usage_limit WHERE agent_id = ?", agentId)).changes === 1;
}
