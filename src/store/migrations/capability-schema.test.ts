import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../database.js";
import { runMigrations } from "../migrator.js";

const NOW = 1_700_000_000_000;

function prepare(): Database.Database {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.prepare(
    "INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("tsk_1", "补接口契约", "ou_1", "agent:codex", "aw", "exec", "running", "a2a", NOW, NOW);
  return db;
}

function insertCapability(
  db: Database.Database,
  overrides: Record<string, unknown> = {},
): void {
  const row = {
    id: "cap_1",
    subject: "agent:codex",
    target: "db:aw-prod",
    action: "read",
    status: "pending",
    ttl_seconds: 900,
    task_id: "tsk_1",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO capability (id, subject, target, action, status, ttl_seconds, task_id, created_at, updated_at)
     VALUES (@id, @subject, @target, @action, @status, @ttl_seconds, @task_id, @created_at, @updated_at)`,
  ).run(row);
}

describe("capability 表约束", () => {
  it("未给 TTL 时落库为 15 分钟", () => {
    const db = prepare();
    db.prepare(
      `INSERT INTO capability (id, subject, target, action, status, task_id, created_at, updated_at)
       VALUES ('cap_default', 'agent:codex', 'db:aw-prod', 'read', 'pending', 'tsk_1', ?, ?)`,
    ).run(NOW, NOW);
    expect(db.prepare("SELECT ttl_seconds FROM capability").get()).toEqual({ ttl_seconds: 900 });
    db.close();
  });

  it("action / status / TTL 只收枚举与合法范围", () => {
    const db = prepare();
    const cases = [
      { id: "cap_bad_action", action: "delete" },
      { id: "cap_bad_status", status: "signed" },
      { id: "cap_bad_ttl", ttl_seconds: 14401 },
    ];
    for (const overrides of cases) {
      expect(() => insertCapability(db, overrides)).toThrow(/CHECK constraint failed/);
    }
    db.close();
  });

  it("authorization 必须挂已存在任务", () => {
    const db = prepare();
    expect(() => insertCapability(db, { id: "cap_orphan", task_id: "tsk_missing" })).toThrow(
      /FOREIGN KEY/,
    );
    db.close();
  });
});

describe("审计表 append-only", () => {
  function insertAudit(db: Database.Database): void {
    db.prepare(
      "INSERT INTO capability_audit (capability_id, action, actor, occurred_at) VALUES (?, ?, ?, ?)",
    ).run("cap_1", "requested", "agent:codex", NOW);
  }

  function insertToolCall(db: Database.Database): void {
    db.prepare(
      `INSERT INTO tool_call_log (run_id, agent_id, task_id, tool, args_hash, level, verdict, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("run_1", "agent:codex", "tsk_1", "db.query", "sha256:abc", "L0", "allow", NOW);
  }

  it("capability_audit 拒绝 UPDATE / DELETE", () => {
    const db = prepare();
    insertCapability(db);
    insertAudit(db);

    expect(() => db.prepare("UPDATE capability_audit SET actor = 'agent:writer'").run()).toThrow(
      /append-only/,
    );
    expect(() => db.prepare("DELETE FROM capability_audit").run()).toThrow(/append-only/);
    expect(db.prepare("SELECT actor FROM capability_audit").get()).toEqual({ actor: "agent:codex" });
    db.close();
  });

  it("tool_call_log 拒绝 UPDATE / DELETE,level / verdict 只收枚举", () => {
    const db = prepare();
    insertCapability(db);
    insertToolCall(db);

    expect(() => db.prepare("UPDATE tool_call_log SET verdict = 'allow'").run()).toThrow(
      /append-only/,
    );
    expect(() => db.prepare("DELETE FROM tool_call_log").run()).toThrow(/append-only/);

    expect(() =>
      db
        .prepare(
          `INSERT INTO tool_call_log (run_id, agent_id, task_id, tool, args_hash, level, verdict, occurred_at)
           VALUES ('run_2', 'agent:codex', 'tsk_1', 'fs.write', 'sha256:def', 'L3', 'allow', ?)`,
        )
        .run(NOW),
    ).toThrow(/CHECK constraint failed/);
    db.close();
  });
});
