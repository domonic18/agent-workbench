import type { Db } from "../database.js";

export interface SessionRecord {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

const COLUMNS = `
  id, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt
`;

export function createSession(
  db: Db,
  input: { id: string; createdAt: number; expiresAt: number },
): Promise<void>{
  await db.run(
    "INSERT INTO session (id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)",
  , input.id, input.createdAt, input.createdAt, input.expiresAt);
}

/** 只返回未过期会话;过期判定以库中 expires_at 为准 */
export function findActiveSession(db: Db, id: string, now: number): Promise<SessionRecord | undefined>{
  return await db.get(`SELECT ${COLUMNS} FROM session WHERE id = ? AND expires_at > ?`, id, now) as SessionRecord | undefined;
}

export function touchSession(db: Db, id: string, now: number): Promise<void>{
  await db.run("UPDATE session SET last_seen_at = ? WHERE id = ?", now, id);
}

export function deleteSession(db: Db, id: string): Promise<void>{
  await db.run("DELETE FROM session WHERE id = ?", id);
}
