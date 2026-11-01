import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KnowledgeEntryNotFoundError,
  type KnowledgeIndexService,
} from "../../domain/knowledge/index-service.js";
import type { KnowledgeRebuildResult } from "../../domain/knowledge/indexer.js";
import type { KnowledgeRebuilder } from "../../domain/knowledge/rebuild.js";
import { openDatabase, type Db } from "../../store/database.js";
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

describe("knowledge 路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let running: boolean;
  let start: ReturnType<typeof vi.fn<() => Promise<KnowledgeRebuildResult>>>;
  let reindex: ReturnType<typeof vi.fn<KnowledgeIndexService["reindexEntry"]>>;

  function writeHeaders(): Record<string, string> {
    return { cookie, "x-requested-with": "fetch", "idempotency-key": "key-1" };
  }

  beforeEach(async () => {
    db = openDatabase(":memory:");
    runMigrations(db);
    ensureConsoleCredential(db, PASSWORD);
    running = false;
    start = vi.fn(async () => RESULT);
    reindex = vi.fn<KnowledgeIndexService["reindexEntry"]>(async () => "ready");
    const rebuilder: KnowledgeRebuilder = { isRunning: () => running, start };
    app = buildApp({
      logLevel: "silent",
      db,
      knowledgeRebuilder: rebuilder,
      knowledgeIndexer: { reindexEntry: reindex },
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
});
