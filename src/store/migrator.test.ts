import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestDatabase, resolveTestAdminUrl, type Db } from "./database.js";
import { defaultMigrationsDir, runMigrations } from "./migrator.js";

async function tableNames(db: Db): Promise<string[]> {
  const rows = (await db.all(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  )) as { name: string }[];
  return rows.map((row) => row.name);
}

describe("runMigrations", () => {
  it("空库执行建表并记账", async () => {
    const db = await createTestDatabase(resolveTestAdminUrl());

    expect(await runMigrations(db)).toBe(4);
    expect(await tableNames(db)).toEqual(
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
        "outbox",
        "audit_reconcile_gap",
        "machine",
        "agent",
        "a2a_thread",
        "a2a_message",
        "a2a_dead_letter",
        "agent_run",
        "timeline_event",
        "token_usage",
        "ingest_receipt",
        "login_failure",
        "idempotency_record",
        "scope_revision",
        "knowledge_entry",
        "knowledge_chunk",
        "knowledge_vec",
        "schema_migration",
      ]),
    );

    const applied = await db.all("SELECT version, name FROM schema_migration");
    expect(applied).toEqual([
      { version: 1, name: "pg_bootstrap" },
      { version: 2, name: "pg_mcp_tool_calls" },
      { version: 3, name: "one_time_tokens" },
      { version: 4, name: "bootstrap_delivery" },
    ]);
    await db.close();
  });

  it("重复启动不重跑", async () => {
    const db = await createTestDatabase(resolveTestAdminUrl());

    await runMigrations(db);
    expect(await runMigrations(db)).toBe(0);
    await db.close();
  });

  it("已应用的迁移被改写时启动失败", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-migrations-"));
    const source = readFileSync(join(defaultMigrationsDir(), "0001_pg_bootstrap.sql"), "utf8");
    const file = join(dir, "0001_pg_bootstrap.sql");
    writeFileSync(file, source);

    const db = await createTestDatabase(resolveTestAdminUrl());
    await runMigrations(db, dir);

    writeFileSync(file, `${source}\n-- 事后补丁\n`);
    await expect(runMigrations(db, dir)).rejects.toThrow(/已应用但内容已变更/);
    await db.close();
  });

  it("迁移在事务内执行,失败不留半成品", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-migrations-"));
    writeFileSync(
      join(dir, "0001_broken.sql"),
      "CREATE TABLE ok_table (id TEXT PRIMARY KEY);\nCREATE TABLE bad_table (id TEXT,);\n",
    );

    const db = await createTestDatabase(resolveTestAdminUrl());
    await expect(runMigrations(db, dir)).rejects.toThrow();
    expect(await tableNames(db)).not.toContain("ok_table");
    expect(await db.get("SELECT COUNT(*) AS n FROM schema_migration")).toEqual({ n: 0 });
    await db.close();
  });
});
