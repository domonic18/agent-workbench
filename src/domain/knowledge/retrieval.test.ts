import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertKnowledgeChunk, insertKnowledgeEntry } from "../../store/repositories/knowledge.js";
import { searchKnowledge } from "./retrieval.js";

const NOW = 1_700_000_000_000;

async function prepare(): Promise<Db> {
  return openDatabase();
}

describe("searchKnowledge", () => {
  it("只返回 active 条目,candidate/archived/已删除不可见", async () => {
    const db = await prepare();
    await insertKnowledgeEntry(db, {
      id: "kb_active", path: "notes/a.md", title: "部署手册", summary: "回滚步骤",
      category: "", status: "active", sourceTaskId: null, sourceAgentId: null, createdAt: NOW,
    });
    await insertKnowledgeEntry(db, {
      id: "kb_cand", path: "notes/b.md", title: "候选部署手册", summary: "",
      category: "", status: "candidate", sourceTaskId: null, sourceAgentId: null, createdAt: NOW,
    });
    await insertKnowledgeEntry(db, {
      id: "kb_arch", path: "notes/c.md", title: "归档部署手册", summary: "",
      category: "", status: "archived", sourceTaskId: null, sourceAgentId: null, createdAt: NOW,
    });

    const hits = await searchKnowledge(db, { search: "部署手册" });
    expect(hits.map((hit) => hit.entryId)).toEqual(["kb_active"]);
    await db.close();
  });

  it("命中分块正文时带出处(chunkNo+content),条目命中只有标题出处", async () => {
    const db = await prepare();
    await insertKnowledgeEntry(db, {
      id: "kb_1", path: "notes/a.md", title: "发件箱重试策略", summary: "",
      category: "", status: "active", sourceTaskId: null, sourceAgentId: null, createdAt: NOW,
    });
    await insertKnowledgeChunk(db, "kb_1", 0, "发件箱指数退避从 5 秒开始");
    await insertKnowledgeEntry(db, {
      id: "kb_2", path: "notes/b.md", title: "发件箱巡检清单", summary: "",
      category: "", status: "active", sourceTaskId: null, sourceAgentId: null, createdAt: NOW,
    });

    const byChunk = await searchKnowledge(db, { search: "指数退避" });
    expect(byChunk).toHaveLength(1);
    expect(byChunk[0]).toMatchObject({
      entryId: "kb_1", path: "notes/a.md", chunkNo: 0, content: "发件箱指数退避从 5 秒开始",
    });

    const byTitle = await searchKnowledge(db, { search: "发件箱" });
    expect(byTitle.map((hit) => hit.entryId)).toEqual(["kb_2", "kb_1"]);
    expect(byTitle[1]).toMatchObject({ chunkNo: null, content: null });
    await db.close();
  });

  it("LIKE 通配符按字面匹配,空查询返回空", async () => {
    const db = await prepare();
    await insertKnowledgeEntry(db, {
      id: "kb_1", path: "notes/a.md", title: "百分号说明", summary: "",
      category: "", status: "active", sourceTaskId: null, sourceAgentId: null, createdAt: NOW,
    });

    expect(await searchKnowledge(db, { search: "%" })).toEqual([]);
    expect(await searchKnowledge(db, { search: "  " })).toEqual([]);
    expect((await searchKnowledge(db, { search: "百分号" })).map((hit) => hit.entryId)).toEqual([
      "kb_1",
    ]);
    await db.close();
  });
});
