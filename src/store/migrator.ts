import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./database.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function defaultMigrationsDir(): string {
  return fileURLToPath(new URL("./migrations/", import.meta.url));
}

/** 按版本号升序载入;版本重复或为空目录直接失败,不猜执行顺序。 */
export function loadMigrations(dir: string = defaultMigrationsDir()): Migration[] {
  const migrations: Migration[] = [];
  const seen = new Set<number>();

  for (const file of readdirSync(dir)) {
    const match = MIGRATION_FILE.exec(file);
    if (match === null) {
      continue;
    }
    const [, versionText = "", name = ""] = match;
    const version = Number.parseInt(versionText, 10);
    if (seen.has(version)) {
      throw new Error(`迁移版本重复: ${version}`);
    }
    seen.add(version);

    const sql = readFileSync(join(dir, file), "utf8");
    migrations.push({
      version,
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }

  if (migrations.length === 0) {
    throw new Error(`迁移目录为空: ${dir}`);
  }
  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * forward-only:已应用的迁移只校验不重跑,内容变了即启动失败(02 §7)。
 * 返回本次新应用的条数,重复启动返回 0。
 */
export function runMigrations(db: Db, dir?: string): number {
  const migrations = loadMigrations(dir);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const appliedRows = db
    .prepare("SELECT version, name, checksum FROM schema_migration")
    .all() as { version: number; name: string; checksum: string }[];
  const applied = new Map(appliedRows.map((row) => [row.version, row]));

  const record = db.prepare(
    "INSERT INTO schema_migration (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
  );

  let count = 0;
  for (const migration of migrations) {
    const previous = applied.get(migration.version);
    if (previous !== undefined) {
      if (previous.checksum !== migration.checksum || previous.name !== migration.name) {
        throw new Error(
          `迁移 ${migration.version}_${previous.name} 已应用但内容已变更;迁移只允许新增,禁止改写`,
        );
      }
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, migration.checksum, Date.now());
    })();
    count += 1;
  }
  return count;
}
