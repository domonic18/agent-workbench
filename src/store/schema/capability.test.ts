import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";

const NOW = 1_700_000_000_000;

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await db.run(
    "INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "tsk_1", "补接口契约", "ou_1", "agent:codex", "aw", "exec", "running", "a2a", NOW, NOW,
  );
  return db;
}

async function insertCapability(
  db: Db,
  overrides: Record<string, unknown> = {},
): Promise<void> {
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
  await db.run(
    `INSERT INTO capability (id, subject, target, action, status, ttl_seconds, task_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.subject, row.target, row.action, row.status, row.ttl_seconds,
    row.task_id, row.created_at, row.updated_at,
  );
}

describe("capability 表约束", () => {
  it("未给 TTL 时落库为 15 分钟", async () => {
    const db = await prepare();
    await db.run(
      `INSERT INTO capability (id, subject, target, action, status, task_id, created_at, updated_at)
       VALUES ('cap_default', 'agent:codex', 'db:aw-prod', 'read', 'pending', 'tsk_1', ?, ?)`,
      NOW, NOW,
    );
    expect(await db.get("SELECT ttl_seconds FROM capability")).toEqual({ ttl_seconds: 900 });
    await db.close();
  });

  it("action / status / TTL 只收枚举与合法范围", async () => {
    const db = await prepare();
    const cases = [
      { id: "cap_bad_action", action: "delete" },
      { id: "cap_bad_status", status: "signed" },
      { id: "cap_bad_ttl", ttl_seconds: 14401 },
    ];
    for (const overrides of cases) {
      await expect(insertCapability(db, overrides)).rejects.toThrow(/check constraint/i);
    }
    await db.close();
  });

  it("authorization 必须挂已存在任务", async () => {
    const db = await prepare();
    await expect(
      insertCapability(db, { id: "cap_orphan", task_id: "tsk_missing" }),
    ).rejects.toThrow(/foreign key/i);
    await db.close();
  });
});

describe("审计表 append-only", () => {
  async function insertAudit(db: Db): Promise<void> {
    await db.run(
      "INSERT INTO capability_audit (capability_id, action, actor, occurred_at) VALUES (?, ?, ?, ?)",
      "cap_1", "requested", "agent:codex", NOW,
    );
  }

  async function insertToolCall(db: Db): Promise<void> {
    await db.run(
      `INSERT INTO tool_call_log (run_id, agent_id, task_id, tool, args_hash, level, verdict, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      "run_1", "agent:codex", "tsk_1", "db.query", "sha256:abc", "L0", "allow", NOW,
    );
  }

  it("capability_audit 拒绝 UPDATE / DELETE", async () => {
    const db = await prepare();
    await insertCapability(db);
    await insertAudit(db);

    await expect(db.run("UPDATE capability_audit SET actor = 'agent:writer'")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.run("DELETE FROM capability_audit")).rejects.toThrow(/append-only/);
    expect(await db.get("SELECT actor FROM capability_audit")).toEqual({ actor: "agent:codex" });
    await db.close();
  });

  it("tool_call_log 拒绝 UPDATE / DELETE,level / verdict 只收枚举", async () => {
    const db = await prepare();
    await insertCapability(db);
    await insertToolCall(db);

    await expect(db.run("UPDATE tool_call_log SET verdict = 'allow'")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.run("DELETE FROM tool_call_log")).rejects.toThrow(/append-only/);

    await expect(
      db.run(
        `INSERT INTO tool_call_log (run_id, agent_id, task_id, tool, args_hash, level, verdict, occurred_at)
         VALUES ('run_2', 'agent:codex', 'tsk_1', 'fs.write', 'sha256:def', 'L3', 'allow', ?)`,
        NOW,
      ),
    ).rejects.toThrow(/check constraint/i);
    await db.close();
  });
});
