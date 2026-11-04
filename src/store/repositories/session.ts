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
): void {
  db.prepare(
    "INSERT INTO session (id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(input.id, input.createdAt, input.createdAt, input.expiresAt);
}

/** 只返回未过期会话;过期判定以库中 expires_at 为准 */
export function findActiveSession(db: Db, id: string, now: number): SessionRecord | undefined {
  return db
    .prepare(`SELECT ${COLUMNS} FROM session WHERE id = ? AND expires_at > ?`)
    .get(id, now) as SessionRecord | undefined;
}

export function touchSession(db: Db, id: string, now: number): void {
  db.prepare("UPDATE session SET last_seen_at = ? WHERE id = ?").run(now, id);
}

export function deleteSession(db: Db, id: string): void {
  db.prepare("DELETE FROM session WHERE id = ?").run(id);
}
