import Database from "better-sqlite3";

export type Db = Database.Database;

/** 打开库并应用 02 §5 的连接纪律:WAL、外键、忙等窗口。 */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/**
 * `/healthz` 的判据是「库可写」而非「进程活着」:只读挂载或磁盘满时
 * 单靠 `SELECT 1` 仍会成功,必须真的拿一次写锁。
 */
export function isDatabaseWritable(db: Db): boolean {
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec("ROLLBACK");
    return true;
  } catch {
    return false;
  }
}
