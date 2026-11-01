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
  listKnowledgeChunkIds,
  listKnowledgeChunks,
} from "../../store/repositories/knowledge.js";
import type { EmbeddingClient } from "./embedding.js";
import {
  indexKnowledgeEntry,
  rebuildKnowledgeIndex,
  type KnowledgeRebuildResult,
} from "./indexer.js";

const NOW = 1_700_000_000_000;

interface Fixture {
  dir: string;
  db: Db;
}

function openFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "aw-knowledge-"));
  mkdirSync(join(dir, "notes"), { recursive: true });
  const db = openDatabase(":memory:");
  runMigrations(db);
  return { dir, db };
}

function addEntry(db: Db, id: string, path: string): void {
  insertKnowledgeEntry(db, {
    id,
    path,
    title: id,
    summary: "",
    category: "",
    status: "active",
    sourceTaskId: null,
    sourceAgentId: null,
    createdAt: NOW,
  });
}

function writeEntry(dir: string, path: string, content: string): void {
  writeFileSync(join(dir, path), content);
}

function fakeEmbedding(): EmbeddingClient {
  return {
    embed: async (texts) =>
      texts.map(() => Float32Array.from({ length: KNOWLEDGE_INDEX.dimensions }, () => 0.1)),
  };
}

function ftsHits(db: Db, term: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM knowledge_fts WHERE knowledge_fts MATCH ?")
      .get(`"${term}"`) as { n: number }
  ).n;
}

function vectorCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM knowledge_vec").get() as { n: number }).n;
}

function options(fixture: Fixture, embedding?: EmbeddingClient) {
  return {
    knowledgeDir: fixture.dir,
    now: () => NOW,
    ...(embedding === undefined ? {} : { embedding }),
  };
}

describe("indexKnowledgeEntry", () => {
  it("首次索引写入分块、FTS 与向量并标 ready", async () => {
    const fixture = openFixture();
    addEntry(fixture.db, "kb_1", "notes/deploy.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册\n\n回滚步骤: 执行回滚");

    const entry = findKnowledgeEntry(fixture.db, "kb_1");
    if (entry === undefined) throw new Error("条目未落库");
    expect(await indexKnowledgeEntry(fixture.db, entry, options(fixture, fakeEmbedding()))).toBe(
      "ready",
    );

    const updated = findKnowledgeEntry(fixture.db, "kb_1");
    expect(updated?.embeddingStatus).toBe("ready");
    expect(updated?.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const chunks = listKnowledgeChunks(fixture.db, "kb_1");
    expect(chunks.length).toBeGreaterThan(0);
    expect(ftsHits(fixture.db, "部署手册")).toBe(1);
    expect(vectorCount(fixture.db)).toBe(chunks.length);
    fixture.db.close();
  });

  it("内容未变时跳过且分块保持不变", async () => {
    const fixture = openFixture();
    addEntry(fixture.db, "kb_1", "notes/deploy.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册");
    const embedding = fakeEmbedding();

    const entry = findKnowledgeEntry(fixture.db, "kb_1");
    if (entry === undefined) throw new Error("条目未落库");
    await indexKnowledgeEntry(fixture.db, entry, options(fixture, embedding));
    const before = listKnowledgeChunkIds(fixture.db, "kb_1");

    const again = findKnowledgeEntry(fixture.db, "kb_1");
    if (again === undefined) throw new Error("条目未落库");
    expect(await indexKnowledgeEntry(fixture.db, again, options(fixture, embedding))).toBe(
      "skipped",
    );
    expect(listKnowledgeChunkIds(fixture.db, "kb_1")).toEqual(before);
    fixture.db.close();
  });

  it("内容变更后替换分块,force 也能强制重建", async () => {
    const fixture = openFixture();
    addEntry(fixture.db, "kb_1", "notes/deploy.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册");
    const embedding = fakeEmbedding();

    const first = findKnowledgeEntry(fixture.db, "kb_1");
    if (first === undefined) throw new Error("条目未落库");
    await indexKnowledgeEntry(fixture.db, first, options(fixture, embedding));
    const before = listKnowledgeChunkIds(fixture.db, "kb_1");

    writeEntry(fixture.dir, "notes/deploy.md", "回滚步骤");
    const changed = findKnowledgeEntry(fixture.db, "kb_1");
    if (changed === undefined) throw new Error("条目未落库");
    expect(await indexKnowledgeEntry(fixture.db, changed, options(fixture, embedding))).toBe(
      "ready",
    );
    expect(listKnowledgeChunkIds(fixture.db, "kb_1")).not.toEqual(before);
    expect(ftsHits(fixture.db, "回滚步骤")).toBe(1);
    expect(ftsHits(fixture.db, "部署手册")).toBe(0);

    const forced = findKnowledgeEntry(fixture.db, "kb_1");
    if (forced === undefined) throw new Error("条目未落库");
    expect(
      await indexKnowledgeEntry(fixture.db, forced, { ...options(fixture, embedding), force: true }),
    ).toBe("ready");
    fixture.db.close();
  });

  it("嵌入失败仍保留关键词索引并标 failed", async () => {
    const fixture = openFixture();
    addEntry(fixture.db, "kb_1", "notes/deploy.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册");
    const broken: EmbeddingClient = {
      embed: async () => {
        throw new Error("upstream down");
      },
    };

    const entry = findKnowledgeEntry(fixture.db, "kb_1");
    if (entry === undefined) throw new Error("条目未落库");
    expect(await indexKnowledgeEntry(fixture.db, entry, options(fixture, broken))).toBe("failed");

    expect(findKnowledgeEntry(fixture.db, "kb_1")?.embeddingStatus).toBe("failed");
    expect(ftsHits(fixture.db, "部署手册")).toBe(1);
    expect(
      fixture.db.prepare("SELECT name FROM sqlite_master WHERE name = 'knowledge_vec'").get(),
    ).toBeUndefined();
    fixture.db.close();
  });

  it("未配置嵌入时只建关键词索引并标 pending", async () => {
    const fixture = openFixture();
    addEntry(fixture.db, "kb_1", "notes/deploy.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册");

    const entry = findKnowledgeEntry(fixture.db, "kb_1");
    if (entry === undefined) throw new Error("条目未落库");
    expect(await indexKnowledgeEntry(fixture.db, entry, options(fixture))).toBe("pending");

    expect(findKnowledgeEntry(fixture.db, "kb_1")?.embeddingStatus).toBe("pending");
    expect(ftsHits(fixture.db, "部署手册")).toBe(1);
    fixture.db.close();
  });
});

describe("rebuildKnowledgeIndex", () => {
  it("统计缺失文件与越界路径,其余正常索引", async () => {
    const fixture = openFixture();
    addEntry(fixture.db, "kb_1", "notes/deploy.md");
    addEntry(fixture.db, "kb_missing", "notes/gone.md");
    addEntry(fixture.db, "kb_escape", "../outside.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册");

    const result: KnowledgeRebuildResult = await rebuildKnowledgeIndex(
      fixture.db,
      options(fixture, fakeEmbedding()),
    );

    expect(result).toEqual({ indexed: 1, skipped: 0, failed: 1, missing: 1 });
    expect(findKnowledgeEntry(fixture.db, "kb_1")?.embeddingStatus).toBe("ready");
    expect(findKnowledgeEntry(fixture.db, "kb_escape")?.embeddingStatus).toBe("failed");
    expect(findKnowledgeEntry(fixture.db, "kb_missing")?.embeddingStatus).toBe("pending");
    fixture.db.close();
  });
});
