import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWLEDGE_INDEX } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
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

async function openFixture(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), "aw-knowledge-"));
  mkdirSync(join(dir, "notes"), { recursive: true });
  const db = await openDatabase();
  return { dir, db };
}

async function addEntry(db: Db, id: string, path: string): Promise<void> {
  await insertKnowledgeEntry(db, {
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

async function keywordHits(db: Db, term: string): Promise<number> {
  return (
    (await db.get(
      "SELECT COUNT(*) AS n FROM knowledge_chunk WHERE content LIKE ?",
      `%${term}%`,
    )) as { n: number }
  ).n;
}

async function vectorCount(db: Db): Promise<number> {
  return ((await db.get("SELECT COUNT(*) AS n FROM knowledge_vec")) as { n: number }).n;
}

function options(fixture: Fixture, embedding?: EmbeddingClient) {
  return {
    knowledgeDir: fixture.dir,
    now: () => NOW,
    ...(embedding === undefined ? {} : { embedding }),
  };
}

describe("indexKnowledgeEntry", () => {
  it("首次索引写入分块、关键词索引与向量并标 ready", async () => {
    const fixture = await openFixture();
    await addEntry(fixture.db, "kb_1", "notes/deploy.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册\n\n回滚步骤: 执行回滚");

    const entry = await findKnowledgeEntry(fixture.db, "kb_1");
    if (entry === undefined) throw new Error("条目未落库");
    expect(await indexKnowledgeEntry(fixture.db, entry, options(fixture, fakeEmbedding()))).toBe(
      "ready",
    );

    const updated = await findKnowledgeEntry(fixture.db, "kb_1");
    expect(updated?.embeddingStatus).toBe("ready");
    expect(updated?.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const chunks = await listKnowledgeChunks(fixture.db, "kb_1");
    expect(chunks.length).toBeGreaterThan(0);
    expect(await keywordHits(fixture.db, "部署手册")).toBe(1);
    expect(await vectorCount(fixture.db)).toBe(chunks.length);
    await fixture.db.close();
  });

  it("内容未变时跳过且分块保持不变", async () => {
    const fixture = await openFixture();
    await addEntry(fixture.db, "kb_1", "notes/deploy.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册");
    const embedding = fakeEmbedding();

    const entry = await findKnowledgeEntry(fixture.db, "kb_1");
    if (entry === undefined) throw new Error("条目未落库");
    await indexKnowledgeEntry(fixture.db, entry, options(fixture, embedding));
    const before = await listKnowledgeChunkIds(fixture.db, "kb_1");

    const again = await findKnowledgeEntry(fixture.db, "kb_1");
    if (again === undefined) throw new Error("条目未落库");
    expect(await indexKnowledgeEntry(fixture.db, again, options(fixture, embedding))).toBe(
      "skipped",
    );
    expect(await listKnowledgeChunkIds(fixture.db, "kb_1")).toEqual(before);
    await fixture.db.close();
  });

  it("内容变更后替换分块,force 也能强制重建", async () => {
    const fixture = await openFixture();
    await addEntry(fixture.db, "kb_1", "notes/deploy.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册");
    const embedding = fakeEmbedding();

    const first = await findKnowledgeEntry(fixture.db, "kb_1");
    if (first === undefined) throw new Error("条目未落库");
    await indexKnowledgeEntry(fixture.db, first, options(fixture, embedding));
    const before = await listKnowledgeChunkIds(fixture.db, "kb_1");

    writeEntry(fixture.dir, "notes/deploy.md", "回滚步骤");
    const changed = await findKnowledgeEntry(fixture.db, "kb_1");
    if (changed === undefined) throw new Error("条目未落库");
    expect(await indexKnowledgeEntry(fixture.db, changed, options(fixture, embedding))).toBe(
      "ready",
    );
    expect(await listKnowledgeChunkIds(fixture.db, "kb_1")).not.toEqual(before);
    expect(await keywordHits(fixture.db, "回滚步骤")).toBe(1);
    expect(await keywordHits(fixture.db, "部署手册")).toBe(0);

    const forced = await findKnowledgeEntry(fixture.db, "kb_1");
    if (forced === undefined) throw new Error("条目未落库");
    expect(
      await indexKnowledgeEntry(fixture.db, forced, { ...options(fixture, embedding), force: true }),
    ).toBe("ready");
    await fixture.db.close();
  });

  it("嵌入失败仍保留关键词索引并标 failed", async () => {
    const fixture = await openFixture();
    await addEntry(fixture.db, "kb_1", "notes/deploy.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册");
    const broken: EmbeddingClient = {
      embed: async () => {
        throw new Error("upstream down");
      },
    };

    const entry = await findKnowledgeEntry(fixture.db, "kb_1");
    if (entry === undefined) throw new Error("条目未落库");
    expect(await indexKnowledgeEntry(fixture.db, entry, options(fixture, broken))).toBe("failed");

    expect((await findKnowledgeEntry(fixture.db, "kb_1"))?.embeddingStatus).toBe("failed");
    expect(await keywordHits(fixture.db, "部署手册")).toBe(1);
    // 向量表常驻(pgvector 由迁移创建),失败路径下不写向量行
    expect(await vectorCount(fixture.db)).toBe(0);
    await fixture.db.close();
  });

  it("未配置嵌入时只建关键词索引并标 pending", async () => {
    const fixture = await openFixture();
    await addEntry(fixture.db, "kb_1", "notes/deploy.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册");

    const entry = await findKnowledgeEntry(fixture.db, "kb_1");
    if (entry === undefined) throw new Error("条目未落库");
    expect(await indexKnowledgeEntry(fixture.db, entry, options(fixture))).toBe("pending");

    expect((await findKnowledgeEntry(fixture.db, "kb_1"))?.embeddingStatus).toBe("pending");
    expect(await keywordHits(fixture.db, "部署手册")).toBe(1);
    await fixture.db.close();
  });
});

describe("rebuildKnowledgeIndex", () => {
  it("统计缺失文件与越界路径,其余正常索引", async () => {
    const fixture = await openFixture();
    await addEntry(fixture.db, "kb_1", "notes/deploy.md");
    await addEntry(fixture.db, "kb_missing", "notes/gone.md");
    await addEntry(fixture.db, "kb_escape", "../outside.md");
    writeEntry(fixture.dir, "notes/deploy.md", "部署手册");

    const result: KnowledgeRebuildResult = await rebuildKnowledgeIndex(
      fixture.db,
      options(fixture, fakeEmbedding()),
    );

    expect(result).toEqual({ indexed: 1, skipped: 0, failed: 1, missing: 1 });
    expect((await findKnowledgeEntry(fixture.db, "kb_1"))?.embeddingStatus).toBe("ready");
    expect((await findKnowledgeEntry(fixture.db, "kb_escape"))?.embeddingStatus).toBe("failed");
    expect((await findKnowledgeEntry(fixture.db, "kb_missing"))?.embeddingStatus).toBe("pending");
    await fixture.db.close();
  });
});
