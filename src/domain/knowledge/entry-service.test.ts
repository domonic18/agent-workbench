import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import {
  countKnowledgeEntriesByStatus,
  findKnowledgeEntry,
  insertKnowledgeChunk,
  insertKnowledgeEntry,
} from "../../store/repositories/knowledge.js";
import {
  createKnowledgeEntryService,
  KnowledgeError,
  type KnowledgeEntryService,
} from "./entry-service.js";
import type { KnowledgeIndexService } from "./index-service.js";

const NOW = 1_700_000_000_000;

async function insert(
  db: Db,
  id: string,
  path: string,
  status: "draft" | "candidate" | "active" | "archived",
  title: string,
): Promise<void> {
  await insertKnowledgeEntry(db, {
    id,
    path,
    title,
    summary: "",
    category: "ops",
    status,
    sourceTaskId: null,
    sourceAgentId: null,
    createdAt: NOW,
  });
}

describe("KnowledgeEntryService", () => {
  let db: Db;
  let dir: string;
  let service: KnowledgeEntryService;
  let reindex: ReturnType<typeof vi.fn<KnowledgeIndexService["reindexEntry"]>>;

  beforeEach(async () => {
    db = await openDatabase();
    dir = mkdtempSync(join(tmpdir(), "aw-knowledge-"));
    mkdirSync(join(dir, "notes"), { recursive: true });
    writeFileSync(join(dir, "notes", "deploy.md"), "# 部署手册\n\n回滚前先备份。");
    writeFileSync(join(dir, "index.md"), "# 索引");
    await insert(db, "kb_active", "notes/deploy.md", "active", "部署手册");
    await insert(db, "kb_candidate", "notes/handoff.md", "candidate", "交接记录");
    await insert(db, "kb_archived", "notes/old.md", "archived", "旧条目");
    writeFileSync(join(dir, "notes", "handoff.md"), "交接内容");
    writeFileSync(join(dir, "notes", "old.md"), "旧内容");
    await insertKnowledgeChunk(db, "kb_active", 0, "数据库回滚步骤：先备份再切换");

    reindex = vi.fn<KnowledgeIndexService["reindexEntry"]>(async () => "pending");
    service = createKnowledgeEntryService({
      db,
      knowledgeDir: dir,
      indexer: { reindexEntry: reindex },
      now: () => NOW + 1_000,
    });
  });

  afterEach(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("按状态列出并返回四个页签计数", async () => {
    const result = await service.list({ status: "active", limit: 10 });
    expect(result.items.map((entry) => entry.id)).toEqual(["kb_active"]);
    expect(result.counts).toEqual({ draft: 0, candidate: 1, active: 1, archived: 1 });
  });

  it("搜索命中标题与分块正文,并转义 LIKE 通配符", async () => {
    expect(
      (await service.list({ status: "active", search: "部署", limit: 10 })).items.map((e) => e.id),
    ).toEqual(["kb_active"]);
    expect(
      (await service.list({ status: "active", search: "回滚步骤", limit: 10 })).items.map((e) => e.id),
    ).toEqual(["kb_active"]);
    expect((await service.list({ status: "active", search: "%", limit: 10 })).items).toEqual([]);
  });

  it("读取正文;文件缺失与条目不存在分别报错", async () => {
    const read = await service.read("kb_active");
    expect(read.content).toContain("回滚前先备份");

    rmSync(join(dir, "notes", "deploy.md"));
    await expect(service.read("kb_active")).rejects.toMatchObject({
      code: "KNOWLEDGE_FILE_MISSING",
    });
    await expect(service.read("kb_missing")).rejects.toBeInstanceOf(KnowledgeError);
  });

  it("编辑写入 Markdown 文件并镜像元数据,索引置 pending 后重索引", async () => {
    const updated = await service.update("kb_active", {
      content: "# 新正文",
      title: "新标题",
      category: "ops",
    });

    expect(readFileSync(join(dir, "notes", "deploy.md"), "utf8")).toBe("# 新正文");
    expect(updated.title).toBe("新标题");
    expect(updated.embeddingStatus).toBe("pending");
    expect(reindex).toHaveBeenCalledWith("kb_active");
  });

  it("受保护文件拒绝编辑", async () => {
    await insert(db, "kb_index", "index.md", "active", "索引");
    await expect(service.update("kb_index", { content: "改写" })).rejects.toMatchObject({
      code: "PROTECTED",
      status: 403,
    });
    expect(readFileSync(join(dir, "index.md"), "utf8")).toBe("# 索引");
  });

  it("候选采纳转 active 并触发重索引,重复采纳幂等", async () => {
    const adopted = await service.adopt("kb_candidate");
    expect(adopted.status).toBe("active");
    expect(reindex).toHaveBeenCalledWith("kb_candidate");

    const again = await service.adopt("kb_candidate");
    expect(again.status).toBe("active");
  });

  it("丢弃转 archived;条目不存在报 404", async () => {
    expect((await service.archive("kb_candidate")).status).toBe("archived");
    expect((await findKnowledgeEntry(db, "kb_candidate"))?.status).toBe("archived");
    await expect(service.archive("kb_missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("已删除条目不进列表与计数", async () => {
    await db.run("UPDATE knowledge_entry SET deleted_at = ? WHERE id = 'kb_active'", NOW);
    expect((await service.list({ status: "active", limit: 10 })).items).toEqual([]);
    expect((await countKnowledgeEntriesByStatus(db)).active).toBe(0);
  });
});
