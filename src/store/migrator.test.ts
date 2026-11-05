import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

const AGENT_INSERT =
  "INSERT INTO agent (id, machine_id, runtime, project, display_name, secret_hash, allowed_targets_json, created_at, updated_at, bootstrap_status) VALUES (?, ?, ?, ?, ?, ?, '[]', 0, 0, 'registered')";

describe("runMigrations", () => {
  it("空库执行建表并记账", async () => {
    const db = await createTestDatabase(resolveTestAdminUrl());

    expect(await runMigrations(db)).toBe(10);
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
        "bootstrap_assembly",
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
        "work_item",
        "work_item_event",
        "work_trigger",
        "work_thread",
        "thread_subscription",
        "worker_inbox",
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
      { version: 5, name: "bootstrap_assembly" },
      { version: 6, name: "machine_less_agent" },
      { version: 7, name: "work_coordination" },
      { version: 8, name: "widen_ingest_counters" },
      { version: 9, name: "agent_display_name" },
      { version: 10, name: "bot_name_refresh" },
    ]);
    await db.close();
  });

  it("重复启动不重跑", async () => {
    const db = await createTestDatabase(resolveTestAdminUrl());

    await runMigrations(db);
    expect(await runMigrations(db)).toBe(0);
    await db.close();
  });

  it("机器无关 Agent:machine_id 可空、runtime 受限、唯一性只在机器维度生效", async () => {
    const db = await createTestDatabase(resolveTestAdminUrl());
    await runMigrations(db);

    const machineId = await db.get<{ nullable: string }>(
      "SELECT is_nullable AS nullable FROM information_schema.columns WHERE table_name = 'agent' AND column_name = 'machine_id'",
    );
    expect(machineId).toEqual({ nullable: "YES" });

    const runtime = await db.get<{ nullable: string; def: string }>(
      "SELECT is_nullable AS nullable, column_default AS def FROM information_schema.columns WHERE table_name = 'agent' AND column_name = 'runtime'",
    );
    expect(runtime).toEqual({ nullable: "NO", def: "'claude_code'::text" });

    await expect(
      db.run(AGENT_INSERT, "agt_bad", null, "bogus", "p", "d", "h"),
    ).rejects.toThrow();

    // 机器无关 Agent 不受 (machine_id, project) 去重约束
    await db.run(AGENT_INSERT, "agt_a", null, "workbuddy", "p", "d", "h");
    await db.run(AGENT_INSERT, "agt_b", null, "workbuddy", "p", "d", "h");
    const count = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM agent WHERE machine_id IS NULL",
    );
    expect(count).toEqual({ n: 2 });

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

  it("0009 把路径形 display_name 回填为项目名,非路径保留", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-migrations-"));
    const sourceDir = defaultMigrationsDir();
    // 先应用 0001~0008,插入坏数据后再单独跑 0009
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const file = readdirSync(sourceDir).find((name) => name.startsWith(`${String(version).padStart(4, "0")}_`));
      if (file === undefined) {
        throw new Error(`缺少迁移 ${version}`);
      }
      writeFileSync(join(dir, file), readFileSync(join(sourceDir, file), "utf8"));
    }

    const db = await createTestDatabase(resolveTestAdminUrl());
    await runMigrations(db, dir);

    await db.run(
      "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'darwin', '1', 'h', 'active', 0)",
    );
    await db.run(AGENT_INSERT, "agt_path", "m1", "claude_code", "bug-triage", "/Users/x/Workspace/bug-triage", "h");
    await db.run(AGENT_INSERT, "agt_name", "m1", "claude_code", "agent-sims", "测试专家", "h");

    const file = readdirSync(sourceDir).find((name) => name.startsWith("0009_"));
    if (file === undefined) {
      throw new Error("缺少迁移 0009");
    }
    writeFileSync(join(dir, file), readFileSync(join(sourceDir, file), "utf8"));
    expect(await runMigrations(db, dir)).toBe(1);

    const rows = (await db.all(
      "SELECT project, display_name AS name FROM agent ORDER BY id",
    )) as Array<{ project: string; name: string }>;
    expect(rows).toEqual([
      { project: "agent-sims", name: "测试专家" },
      { project: "bug-triage", name: "bug-triage" },
    ]);
    await db.close();
  });
});
