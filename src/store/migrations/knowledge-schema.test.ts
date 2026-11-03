import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../database.js";
import { runMigrations } from "../migrator.js";

const NOW = 1_700_000_000_000;

function prepare(): Database.Database {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

function insertEntry(db: Database.Database, overrides: Record<string, unknown> = {}): void {
  const row = {
    id: "kb_1",
    path: "notes/deploy.md",
    title: "部署手册",
    status: "candidate",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
  await db.run(
    `INSERT INTO knowledge_entry (id, path, title, status, source_task_id, source_agent_id, created_at, updated_at)
     VALUES (@id, @path, @title, @status, @source_task_id, @source_agent_id, @created_at, @updated_at)`,  { source_task_id: null, source_agent_id: null, ...row });
}

describe("knowledge_entry 表约束", () => {
  it("未给状态时落库为 draft,来源留空,索引待嵌入", () => {
    const db = prepare();
    await db.run(
      `INSERT INTO knowledge_entry (id, path, title, created_at, updated_at)
       VALUES ('kb_default', 'notes/a.md', 'A', ?, ?)`,  NOW, NOW);
    expect(
      await db.get(
          `SELECT status, source_task_id, source_agent_id, deleted_at, content_hash, embedding_status
             FROM knowledge_entry`,
        ),
    ).toEqual({
      status: "draft",
      source_task_id: null,
      source_agent_id: null,
      deleted_at: null,
      content_hash: null,
      embedding_status: "pending",
    });
    db.close();
  });

  it("status 只收枚举", () => {
    const db = prepare();
    expect(() => insertEntry(db, { id: "kb_bad", status: "published" })).toThrow(
      /CHECK constraint failed/,
    );
    db.close();
  });

  it("path 唯一", () => {
    const db = prepare();
    insertEntry(db);
    expect(() => insertEntry(db, { id: "kb_dup" })).toThrow(/UNIQUE constraint failed/);
    db.close();
  });

  it("分块增删同步 FTS,删除条目级联删分块", () => {
    const db = prepare();
    insertEntry(db);
    await db.run(
      "INSERT INTO knowledge_chunk (entry_id, chunk_no, content) VALUES ('kb_1', 0, ?)",  "部署手册与回滚步骤");
    const hits = (): number =>
      (
        await db.get("SELECT COUNT(*) AS n FROM knowledge_fts WHERE knowledge_fts MATCH ?", '"部署手册"') as { n: number }
      ).n;

    expect(hits()).toBe(1);
    await db.run("DELETE FROM knowledge_chunk WHERE entry_id = 'kb_1'");
    expect(hits()).toBe(0);

    await db.run(
      "INSERT INTO knowledge_chunk (entry_id, chunk_no, content) VALUES ('kb_1', 0, ?)",  "连接失败排查");
    await db.run("DELETE FROM knowledge_entry WHERE id = 'kb_1'");
    expect(await db.get("SELECT COUNT(*) AS n FROM knowledge_chunk")).toEqual({ n: 0 });
    db.close();
  });

  it("来源任务与来源 Agent 必须存在", () => {
    const db = prepare();
    expect(() => insertEntry(db, { id: "kb_task", source_task_id: "tsk_missing" })).toThrow(
      /FOREIGN KEY/,
    );
    expect(() => insertEntry(db, { id: "kb_agent", source_agent_id: "agt_missing" })).toThrow(
      /FOREIGN KEY/,
    );
    db.close();
  });
});
