import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TaskTraits, TeleportAdapter } from "../../adapters/teleport/tctl.js";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { findCapability, listCapabilities } from "../../store/repositories/capability.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  ensureConsoleCredential(db, PASSWORD);
  db.prepare(
    `INSERT INTO task
       (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('T-1', '任务', 'a', 'b', 'aw', 'exec', 'running', 'a2a', 0, 0)`,
  ).run();
  return db;
}

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

const createBody = {
  subject: "agent:codex",
  target: "db:prod",
  action: "read",
  scope: {},
  ttlSeconds: 900,
  taskId: "T-1",
};

describe("capabilities 路由", () => {
  let db: ReturnType<typeof prepare>;
  let app: FastifyInstance;
  let teleport: { calls: TaskTraits[]; adapter: TeleportAdapter };
  let cookie: string;

  beforeEach(async () => {
    db = prepare();
    teleport = {
      calls: [],
      adapter: {
        async applyTaskTraits(traits) {
          teleport.calls.push(traits);
        },
      },
    };
    app = buildApp({ logLevel: "silent", db, teleport: teleport.adapter });
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

  function write(url: string, key: string, payload?: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url,
      headers: {
        cookie,
        "x-requested-with": "XMLHttpRequest",
        "idempotency-key": key,
      },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  it("登录失败与空口令被拒", async () => {
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "wrong-pass" },
    });
    expect(wrong.statusCode).toBe(401);

    const empty = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });
    expect(empty.statusCode).toBe(422);
  });

  it("未登录读列表返回 401", async () => {
    expect((await app.inject({ method: "GET", url: "/api/capabilities" })).statusCode).toBe(401);
  });

  it("写接口依次校验会话、CSRF 头与幂等键", async () => {
    const noSession = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { "x-requested-with": "XMLHttpRequest", "idempotency-key": "k1" },
      payload: createBody,
    });
    expect(noSession.statusCode).toBe(401);

    const noCsrf = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { cookie, "idempotency-key": "k1" },
      payload: createBody,
    });
    expect(noCsrf.statusCode).toBe(403);

    const noKey = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { cookie, "x-requested-with": "XMLHttpRequest" },
      payload: createBody,
    });
    expect(noKey.statusCode).toBe(422);
  });

  it("申请创建 pending,重复幂等键返回首次结果", async () => {
    const first = await write("/api/capabilities", "k1", createBody);
    expect(first.statusCode).toBe(201);
    const created = first.json().capability as { id: string; status: string };
    expect(created.status).toBe("pending");

    const replay = await write("/api/capabilities", "k1", createBody);
    expect(replay.statusCode).toBe(201);
    expect((replay.json().capability as { id: string }).id).toBe(created.id);
    expect(listCapabilities(db, { limit: 10 })).toHaveLength(1);
  });

  it("非法字段返回 422 明细", async () => {
    const bad = await write("/api/capabilities", "k1", { ...createBody, action: "delete" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("批准经 Teleport 落 active,重复批准返回 applied:false", async () => {
    const created = (await write("/api/capabilities", "k1", createBody)).json()
      .capability as { id: string };
    const id = created.id;

    const approved = await write(`/api/capabilities/${id}/approve`, "k2");
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      applied: true,
      capability: { id, status: "active", ticketId: expect.stringMatching(/^tkt_/) },
    });
    expect(teleport.calls).toEqual([
      { botName: "aw-agent-codex", taskId: "T-1", ticketId: expect.stringMatching(/^tkt_/) },
    ]);

    const repeat = await write(`/api/capabilities/${id}/approve`, "k3");
    expect(repeat.json()).toMatchObject({ applied: false, capability: { status: "active" } });
  });

  it("拒绝与吊销只对各自合法状态生效", async () => {
    const first = (await write("/api/capabilities", "k1", createBody)).json()
      .capability as { id: string };
    const rejected = await write(`/api/capabilities/${first.id}/reject`, "k2", {
      reason: "范围过大",
    });
    expect(rejected.json()).toMatchObject({
      applied: true,
      capability: { status: "rejected" },
    });

    const second = (await write("/api/capabilities", "k3", createBody)).json()
      .capability as { id: string };
    await write(`/api/capabilities/${second.id}/approve`, "k4");

    const revoked = await write(`/api/capabilities/${second.id}/revoke`, "k5");
    expect(revoked.json()).toMatchObject({ applied: true, capability: { status: "revoked" } });

    const missing = await write("/api/capabilities/cap_nope/revoke", "k6");
    expect(missing.statusCode).toBe(404);
  });

  it("列表按状态过滤并返回游标", async () => {
    await write("/api/capabilities", "k1", createBody);
    await write("/api/capabilities", "k2", createBody);

    const all = await app.inject({
      method: "GET",
      url: "/api/capabilities?limit=1",
      headers: { cookie },
    });
    expect(all.statusCode).toBe(200);
    const body = all.json() as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toMatch(/^\d+:cap_/);

    const pending = await app.inject({
      method: "GET",
      url: "/api/capabilities?status=pending",
      headers: { cookie },
    });
    expect((pending.json().items as unknown[]).length).toBe(2);

    const badStatus = await app.inject({
      method: "GET",
      url: "/api/capabilities?status=unknown",
      headers: { cookie },
    });
    expect(badStatus.statusCode).toBe(422);
  });

  it("登出后会话失效", async () => {
    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie, "x-requested-with": "XMLHttpRequest" },
    });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/api/capabilities",
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe("签发失败", () => {
  it("Teleport 失败返回 503 并把授权置为 rejected", async () => {
    const db = prepare();
    const failing: TeleportAdapter = {
      async applyTaskTraits() {
        throw new Error("tctl 退出码 1");
      },
    };
    const app = buildApp({ logLevel: "silent", db, teleport: failing });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
    });
    const cookie = cookieOf(login);
    const headers = { cookie, "x-requested-with": "XMLHttpRequest", "idempotency-key": "k1" };

    const created = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers,
      payload: createBody,
    });
    const id = (created.json().capability as { id: string }).id;

    const approved = await app.inject({
      method: "POST",
      url: `/api/capabilities/${id}/approve`,
      headers: { ...headers, "idempotency-key": "k2" },
    });
    expect(approved.statusCode).toBe(503);
    expect(approved.json()).toMatchObject({ error: { code: "UPSTREAM_UNAVAILABLE" } });
    expect(findCapability(db, id)?.status).toBe("rejected");

    await app.close();
    db.close();
  });
});
