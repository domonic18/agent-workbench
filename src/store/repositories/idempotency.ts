import type { Db } from "../database.js";

export interface NewIdempotencyRecord {
  /** 接口作用域,如 capability.create;不同接口的同名 key 互不影响 */
  scope: string;
  key: string;
  resourceId: string;
  createdAt: number;
}

/** 返回首次请求产生的资源 id;未见过该键时返回 undefined */
export function findIdempotencyResource(
  db: Db,
  scope: string,
  key: string,
): Promise<string | undefined>{
  const row = await db.get("SELECT resource_id AS resourceId FROM idempotency_record WHERE scope = ? AND key = ?", scope, key) as { resourceId: string } | undefined;
  return row?.resourceId;
}

export function saveIdempotencyResource(db: Db, row: NewIdempotencyRecord): Promise<void>{
  await db.run(``INSERT INTO idempotency_record (scope, key, resource_id, created_at)
     VALUES (?, ?, ?, ?)`,`, row.scope, row.key, row.resourceId, row.createdAt);
}
