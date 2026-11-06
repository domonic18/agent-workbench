import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

describe("machine 路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let keySeq = 0;

  function writeHeaders(key = `key-${++keySeq}`): Record<string, string> {
    return { cookie, "x-requested-with": "fetch", "idempotency-key": key };
  }

  beforeEach(async () => {
    db = await openDatabase();
    await ensureConsoleCredential(db, PASSWORD);
    app = buildApp({ logLevel: "silent", db });
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
    await db.close();
  });

  async function registerMachine(id = "m1", hostname = "h"): Promise<void> {
    const response = await app.inject({
      method: "POST",
      url: "/api/machines",
      headers: writeHeaders(),
      payload: { id, hostname, os: "linux", collectorVersion: "1" },
    });
    expect(response.statusCode).toBe(201);
  }

  it("未登录 / 缺幂等键都拒绝", async () => {
    expect((await app.inject({ method: "GET", url: "/api/machines" })).statusCode).toBe(401);

    const noKey = await app.inject({
      method: "POST",
      url: "/api/machines",
      headers: { cookie, "x-requested-with": "fetch" },
      payload: { id: "m1", hostname: "h", os: "linux", collectorVersion: "1" },
    });
    expect(noKey.statusCode).toBe(422);
  });

  it("注册机器:明文只返回一次,列表不含哈希", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/machines",
      headers: writeHeaders(),
      payload: { id: "m1", hostname: "h", os: "linux", collectorVersion: "1" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { machine: Record<string, unknown>; secret: string };
    expect(typeof body.secret).toBe("string");
    expect(body.machine).toMatchObject({ id: "m1", status: "active" });
    expect(body.machine).not.toHaveProperty("collectorSecretHash");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/machines",
      headers: writeHeaders(),
      payload: { id: "m1", hostname: "h", os: "linux", collectorVersion: "1" },
    });
    expect(duplicate.statusCode).toBe(409);

    const list = await app.inject({ method: "GET", url: "/api/machines", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("collectorSecretHash");
  });

  it("改展示名:只改展示名,hostname 不动,重放幂等", async () => {
    await registerMachine("m1", "192.168.1.244");

    const renamed = await app.inject({
      method: "PATCH",
      url: "/api/machines/m1",
      headers: writeHeaders("rename-1"),
      payload: { displayName: "macmini" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      machine: { id: "m1", displayName: "macmini", hostname: "192.168.1.244" },
      replayed: false,
    });

    // 同一幂等键重放:不重复执行,返回首次结果
    const replay = await app.inject({
      method: "PATCH",
      url: "/api/machines/m1",
      headers: writeHeaders("rename-1"),
      payload: { displayName: "另一个名字" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      machine: { displayName: "macmini" },
      replayed: true,
    });

    const list = await app.inject({ method: "GET", url: "/api/machines", headers: { cookie } });
    const items = (list.json() as { items: Record<string, unknown>[] }).items;
    expect(items[0]).toMatchObject({ displayName: "macmini", hostname: "192.168.1.244" });
  });

  it("改展示名:未知机器 404,空名与未登录被拒", async () => {
    await registerMachine();

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/machines/m_missing",
      headers: writeHeaders(),
      payload: { displayName: "macmini" },
    });
    expect(missing.statusCode).toBe(404);

    const blank = await app.inject({
      method: "PATCH",
      url: "/api/machines/m1",
      headers: writeHeaders(),
      payload: { displayName: "  " },
    });
    expect(blank.statusCode).toBe(422);

    const anonymous = await app.inject({
      method: "PATCH",
      url: "/api/machines/m1",
      headers: { "x-requested-with": "fetch", "idempotency-key": "anon" },
      payload: { displayName: "macmini" },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
