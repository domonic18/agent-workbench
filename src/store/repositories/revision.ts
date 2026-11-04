import type { Db } from "../database.js";

/** 作用域当前投影版本;尚未产生任何变更时返回 0 */
export async function currentRevision(db: Db, scope: string): Promise<number> {
  const row = (await db.get("SELECT revision FROM scope_revision WHERE scope = ?", scope)) as
    | { revision: number }
    | undefined;
  return row?.revision ?? 0;
}
