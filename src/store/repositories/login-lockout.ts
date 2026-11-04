import type { Db } from "../database.js";

export interface LoginFailureRecord {
  source: string;
  failures: number;
  lockedUntil: number | null;
  updatedAt: number;
}

const COLUMNS = `
  source, failures, locked_until AS lockedUntil, updated_at AS updatedAt
`;

export function findLoginFailure(db: Db, source: string): LoginFailureRecord | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM login_failure WHERE source = ?`).get(source) as
    | LoginFailureRecord
    | undefined;
}

export function upsertLoginFailure(db: Db, row: LoginFailureRecord): void {
  db.prepare(
    `INSERT INTO login_failure (source, failures, locked_until, updated_at)
     VALUES (@source, @failures, @lockedUntil, @updatedAt)
     ON CONFLICT(source) DO UPDATE SET
       failures = excluded.failures,
       locked_until = excluded.locked_until,
       updated_at = excluded.updated_at`,
  ).run(row);
}

export function clearLoginFailures(db: Db, source: string): void {
  db.prepare("DELETE FROM login_failure WHERE source = ?").run(source);
}
