import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { defaultMigrationsDir, runMigrations } from "./migrator.js";

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe("runMigrations", () => {
  it("空库执行建表并记账", () => {
    const db = openDatabase(":memory:");

    expect(runMigrations(db)).toBe(6);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        "task",
        "task_event",
        "console_credential",
        "feishu_event",
        "feishu_command",
        "capability",
        "capability_audit",
        "tool_call_log",
        "session",
        "schema_migration",
      ]),
    );

    const applied = db.prepare("SELECT version, name FROM schema_migration").all();
    expect(applied).toEqual([
      { version: 1, name: "task" },
      { version: 2, name: "console_credential" },
      { version: 3, name: "feishu_event" },
      { version: 4, name: "feishu_command" },
      { version: 5, name: "capability" },
      { version: 6, name: "session" },
    ]);
    db.close();
  });

  it("重复启动不重跑", () => {
    const db = openDatabase(":memory:");

    runMigrations(db);
    expect(runMigrations(db)).toBe(0);
    db.close();
  });

  it("已应用的迁移被改写时启动失败", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-migrations-"));
    const source = readFileSync(join(defaultMigrationsDir(), "0001_task.sql"), "utf8");
    const file = join(dir, "0001_task.sql");
    writeFileSync(file, source);

    const db = openDatabase(":memory:");
    runMigrations(db, dir);

    writeFileSync(file, `${source}\n-- 事后补丁\n`);
    expect(() => runMigrations(db, dir)).toThrow(/已应用但内容已变更/);
    db.close();
  });

  it("迁移在事务内执行,失败不留半成品", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-migrations-"));
    writeFileSync(
      join(dir, "0001_broken.sql"),
      "CREATE TABLE ok_table (id TEXT PRIMARY KEY);\nCREATE TABLE bad_table (id TEXT,);\n",
    );

    const db = openDatabase(":memory:");
    expect(() => runMigrations(db, dir)).toThrow();
    expect(tableNames(db)).not.toContain("ok_table");
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migration").get()).toEqual({ n: 0 });
    db.close();
  });
});
