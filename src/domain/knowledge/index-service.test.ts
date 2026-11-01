import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWLEDGE_INDEX } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import {
  findKnowledgeEntry,
  insertKnowledgeEntry,
} from "../../store/repositories/knowledge.js";
import type { EmbeddingClient } from "./embedding.js";
import {
  createKnowledgeIndexService,
  KnowledgeEntryNotFoundError,
} from "./index-service.js";

const NOW = 1_700_000_000_000;

function fixture(): { db: Db; dir: string; entryPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "aw-knowledge-"));
  mkdirSync(join(dir, "notes"), { recursive: true });
  const db = openDatabase(":memory:");
  runMigrations(db);
  insertKnowledgeEntry(db, {
    id: "kb_1",
    path: "notes/deploy.md",
    title: "部署手册",
    summary: "",
    category: "",
    status: "active",
    sourceTaskId: null,
    sourceAgentId: null,
    createdAt: NOW,
  });
  return { db, dir, entryPath: join(dir, "notes/deploy.md") };
}

const embedding: EmbeddingClient = {
  embed: async (texts) =>
    texts.map(() => Float32Array.from({ length: KNOWLEDGE_INDEX.dimensions }, () => 0.1)),
};

describe("KnowledgeIndexService.reindexEntry", () => {
  it("未登记或已删除的条目报不存在", async () => {
    const { db, dir } = fixture();
    const service = createKnowledgeIndexService({ db, knowledgeDir: dir, embedding });

    await expect(service.reindexEntry("kb_missing")).rejects.toBeInstanceOf(
      KnowledgeEntryNotFoundError,
    );

    db.prepare("UPDATE knowledge_entry SET deleted_at = ? WHERE id = 'kb_1'").run(NOW);
    await expect(service.reindexEntry("kb_1")).rejects.toBeInstanceOf(
      KnowledgeEntryNotFoundError,
    );
    db.close();
  });

  it("文件缺失返回 missing,不改索引状态", async () => {
    const { db, dir } = fixture();
    const service = createKnowledgeIndexService({ db, knowledgeDir: dir, embedding });

    expect(await service.reindexEntry("kb_1")).toBe("missing");
    expect(findKnowledgeEntry(db, "kb_1")?.embeddingStatus).toBe("pending");
    db.close();
  });

  it("文件存在时重建并返回结果", async () => {
    const { db, dir, entryPath } = fixture();
    writeFileSync(entryPath, "部署手册");
    const service = createKnowledgeIndexService({ db, knowledgeDir: dir, embedding });

    expect(await service.reindexEntry("kb_1")).toBe("ready");
    expect(findKnowledgeEntry(db, "kb_1")?.embeddingStatus).toBe("ready");
    db.close();
  });
});
