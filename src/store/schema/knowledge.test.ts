import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";

const NOW = 1_700_000_000_000;

async function prepare(): Promise<Db> {
  return openDatabase();
}

async function insertEntry(db: Db, overrides: Record<string, unknown> = {}): Promise<void> {
  const row: Record<string, unknown> = {
    id: "kb_1",
    path: "notes/deploy.md",
    title: "部署手册",
    status: "candidate",
    source_task_id: null,
    source_agent_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
  await db.run(
    `INSERT INTO knowledge_entry (id, path, title, status, source_task_id, source_agent_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.path, row.title, row.status, row.source_task_id ?? null,
    row.source_agent_id ?? null, row.created_at, row.updated_at,
  );
}

describe("knowledge_entry 表约束", () => {
  it("未给状态时落库为 draft,来源留空,索引待嵌入", async () => {
    const db = await prepare();
    await db.run(
      `INSERT INTO knowledge_entry (id, path, title, created_at, updated_at)
       VALUES ('kb_default', 'notes/a.md', 'A', ?, ?)`,
      NOW, NOW,
    );
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
    await db.close();
  });

  it("status 只收枚举", async () => {
    const db = await prepare();
    await expect(insertEntry(db, { id: "kb_bad", status: "published" })).rejects.toThrow(
      /check constraint/i,
    );
    await db.close();
  });

  it("path 唯一", async () => {
    const db = await prepare();
    await insertEntry(db);
    await expect(insertEntry(db, { id: "kb_dup" })).rejects.toThrow(/duplicate key|unique/i);
    await db.close();
  });

  it("关键词检索走分块 LIKE,删除条目级联删分块", async () => {
    const db = await prepare();
    await insertEntry(db);
    await db.run(
      "INSERT INTO knowledge_chunk (entry_id, chunk_no, content) VALUES ('kb_1', 0, ?)",
      "部署手册与回滚步骤",
    );
    const hits = async (): Promise<number> =>
      (
        (await db.get(
          "SELECT COUNT(*) AS n FROM knowledge_chunk WHERE content LIKE ?",
          "%部署手册%",
        )) as { n: number }
      ).n;

    expect(await hits()).toBe(1);
    await db.run("DELETE FROM knowledge_chunk WHERE entry_id = 'kb_1'");
    expect(await hits()).toBe(0);

    await db.run(
      "INSERT INTO knowledge_chunk (entry_id, chunk_no, content) VALUES ('kb_1', 0, ?)",
      "连接失败排查",
    );
    await db.run("DELETE FROM knowledge_entry WHERE id = 'kb_1'");
    expect(await db.get("SELECT COUNT(*) AS n FROM knowledge_chunk")).toEqual({ n: 0 });
    await db.close();
  });

  it("来源任务与来源 Agent 必须存在", async () => {
    const db = await prepare();
    await expect(
      insertEntry(db, { id: "kb_task", source_task_id: "tsk_missing" }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      insertEntry(db, { id: "kb_agent", source_agent_id: "agt_missing" }),
    ).rejects.toThrow(/foreign key/i);
    await db.close();
  });
});
