import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKnowledgeEntryService } from "../../domain/knowledge/entry-service.js";
import {
  KnowledgeEntryNotFoundError,
  type KnowledgeIndexService,
} from "../../domain/knowledge/index-service.js";
import type { KnowledgeRebuildResult } from "../../domain/knowledge/indexer.js";
import type { KnowledgeRebuilder } from "../../domain/knowledge/rebuild.js";
import { openDatabase, type Db } from "../../store/database.js";
import { insertKnowledgeEntry } from "../../store/repositories/knowledge.js";
import { runMigrations } from "../../store/migrator.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";
const RESULT: KnowledgeRebuildResult = { indexed: 0, skipped: 0, failed: 0, missing: 0 };

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

const NOW = 1_700_000_000_000;

describe("knowledge 路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let dir: string;
  let running: boolean;
  let start: ReturnType<typeof vi.fn<() => Promise<KnowledgeRebuildResult>>>;
  let reindex: ReturnType<typeof vi.fn<KnowledgeIndexService["reindexEntry"]>>;

  function writeHeaders(): Record<string, string> {
    return { cookie, "x-requested-with": "fetch", "idempotency-key": "key-1" };
  }

  function insert(
    id: string,
    path: string,
    status: "candidate" | "active" | "archived",
    title: string,
  ): void {
    insertKnowledgeEntry(db, {
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

  beforeEach(async () => {
    db = openDatabase(":memory:");
    runMigrations(db);
    ensureConsoleCredential(db, PASSWORD);
    running = false;
    start = vi.fn(async () => RESULT);
    reindex = vi.fn<KnowledgeIndexService["reindexEntry"]>(async () => "ready");
    dir = mkdtempSync(join(tmpdir(), "aw-knowledge-route-"));
    mkdirSync(join(dir, "notes"), { recursive: true });
    writeFileSync(join(dir, "notes", "deploy.md"), "# 部署手册\n\n回滚前先备份。");
    writeFileSync(join(dir, "index.md"), "# 索引");
    insert("kb_active", "notes/deploy.md", "active", "部署手册");
    insert("kb_candidate", "notes/handoff.md", "candidate", "交接记录");
    writeFileSync(join(dir, "notes", "handoff.md"), "交接内容");
    const rebuilder: KnowledgeRebuilder = { isRunning: () => running, start };
    app = buildApp({
      logLevel: "silent",
      db,
      knowledgeRebuilder: rebuilder,
      knowledgeIndexer: { reindexEntry: reindex },
      knowledgeEntries: createKnowledgeEntryService({
        db,
        knowledgeDir: dir,
        indexer: { reindexEntry: reindex },
      }),
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookieOf(login);
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("未登录 401,缺幂等键 422", async () => {
    expect(
      (await app.inject({ method: "POST", url: "/api/knowledge/rebuild" })).statusCode,
    ).toBe(401);

    const noKey = await app.inject({
      method: "POST",
      url: "/api/knowledge/rebuild",
      headers: { cookie, "x-requested-with": "fetch" },
    });
    expect(noKey.statusCode).toBe(422);
    expect(start).not.toHaveBeenCalled();
  });

  it("接受重建并异步启动", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/knowledge/rebuild",
      headers: writeHeaders(),
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ started: true });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("重建进行中返回 409 且不重复启动", async () => {
    running = true;
    const response = await app.inject({
      method: "POST",
      url: "/api/knowledge/rebuild",
      headers: writeHeaders(),
    });
    expect(response.statusCode).toBe(409);
    expect(start).not.toHaveBeenCalled();
  });

  it("单条重试返回索引结果", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/knowledge/entries/kb_1/reindex",
      headers: writeHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: "ready" });
    expect(reindex).toHaveBeenCalledWith("kb_1");
  });

  it("单条重试:条目不存在 404,文件缺失 409", async () => {
    reindex.mockRejectedValueOnce(new KnowledgeEntryNotFoundError("kb_x"));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/knowledge/entries/kb_x/reindex",
          headers: writeHeaders(),
        })
      ).statusCode,
    ).toBe(404);

    reindex.mockResolvedValueOnce("missing");
    const missing = await app.inject({
      method: "POST",
      url: "/api/knowledge/entries/kb_1/reindex",
      headers: writeHeaders(),
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toMatchObject({ error: { code: "KNOWLEDGE_FILE_MISSING" } });
  });

  it("整库重建期间单条重试也返回 409", async () => {
    running = true;
    const response = await app.inject({
      method: "POST",
      url: "/api/knowledge/entries/kb_1/reindex",
      headers: writeHeaders(),
    });
    expect(response.statusCode).toBe(409);
    expect(reindex).not.toHaveBeenCalled();
  });

  it("列表默认只列 active,并返回候选数量角标", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/knowledge",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: { id: string }[];
      counts: Record<string, number>;
      nextCursor: string | null;
    };
    expect(body.items.map((item) => item.id)).toEqual(["kb_active"]);
    expect(body.counts).toMatchObject({ active: 1, candidate: 1, archived: 0 });
    expect(body.nextCursor).toBeNull();
  });

  it("按候选页签过滤;非法状态与游标 422", async () => {
    const candidates = await app.inject({
      method: "GET",
      url: "/api/knowledge?status=candidate",
      headers: { cookie },
    });
    expect((candidates.json() as { items: { id: string }[] }).items.map((e) => e.id)).toEqual([
      "kb_candidate",
    ]);

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/knowledge?status=bogus",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/knowledge?cursor=bad",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(422);
  });

  it("详情返回 Markdown 正文与受保护标记", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/knowledge/kb_active",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      entry: { id: "kb_active", path: "notes/deploy.md", protected: false },
      content: "# 部署手册\n\n回滚前先备份。",
    });

    insert("kb_index", "index.md", "active", "索引");
    const index = await app.inject({
      method: "GET",
      url: "/api/knowledge/kb_index",
      headers: { cookie },
    });
    expect((index.json() as { entry: { protected: boolean } }).entry.protected).toBe(true);
  });

  it("文件缺失 409,条目不存在 404", async () => {
    rmSync(join(dir, "notes", "deploy.md"));
    const missing = await app.inject({
      method: "GET",
      url: "/api/knowledge/kb_active",
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toMatchObject({ error: { code: "KNOWLEDGE_FILE_MISSING" } });

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/knowledge/kb_missing",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("编辑写回 Markdown 文件;受保护文件 403;未登录 401", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/knowledge/kb_active",
      headers: writeHeaders(),
      payload: { content: "# 新正文", title: "新标题" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      entry: { id: "kb_active", title: "新标题", embeddingStatus: "pending" },
    });
    expect(readFileSync(join(dir, "notes", "deploy.md"), "utf8")).toBe("# 新正文");

    insert("kb_index", "index.md", "active", "索引");
    const protectedResponse = await app.inject({
      method: "PUT",
      url: "/api/knowledge/kb_index",
      headers: writeHeaders(),
      payload: { content: "改写" },
    });
    expect(protectedResponse.statusCode).toBe(403);
    expect(protectedResponse.json()).toMatchObject({ error: { code: "PROTECTED" } });
    expect(readFileSync(join(dir, "index.md"), "utf8")).toBe("# 索引");

    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/knowledge/kb_active",
          payload: { content: "x" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("逐条采纳候选转 active,丢弃转 archived", async () => {
    const adopted = await app.inject({
      method: "POST",
      url: "/api/knowledge/kb_candidate/adopt",
      headers: writeHeaders(),
    });
    expect(adopted.statusCode).toBe(200);
    expect(adopted.json()).toMatchObject({ entry: { id: "kb_candidate", status: "active" } });
    expect(reindex).toHaveBeenCalledWith("kb_candidate");

    insert("kb_candidate_2", "notes/handoff-2.md", "candidate", "另一条候选");
    const archived = await app.inject({
      method: "POST",
      url: "/api/knowledge/kb_candidate_2/archive",
      headers: writeHeaders(),
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({ entry: { status: "archived" } });
  });

  it("整库重建期间编辑与采纳返回 409", async () => {
    running = true;
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/knowledge/kb_active",
          headers: writeHeaders(),
          payload: { content: "x" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/knowledge/kb_candidate/adopt",
          headers: writeHeaders(),
        })
      ).statusCode,
    ).toBe(409);
  });
});
