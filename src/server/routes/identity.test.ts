import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";

function prepare(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  ensureConsoleCredential(db, PASSWORD);
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

describe("identity 路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let keySeq = 0;

  function writeHeaders(key = `key-${++keySeq}`): Record<string, string> {
    return { cookie, "x-requested-with": "fetch", "idempotency-key": key };
  }

  beforeEach(async () => {
    db = prepare();
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
    db.close();
  });

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

  it("注册 Agent:机器不存在 404,重复 (machine, project) 409", async () => {
    await app.inject({
      method: "POST",
      url: "/api/machines",
      headers: writeHeaders(),
      payload: { id: "m1", hostname: "h", os: "linux", collectorVersion: "1" },
    });

    const missingMachine = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: writeHeaders(),
      payload: { machineId: "nope", project: "aw", displayName: "A" },
    });
    expect(missingMachine.statusCode).toBe(404);

    const created = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: writeHeaders(),
      payload: {
        machineId: "m1",
        project: "aw",
        displayName: "Agent A",
        allowedTargets: ["agt_b"],
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as {
      agent: { id: string; allowedTargets: string[] };
      secret: string;
    };
    expect(body.agent.id).toMatch(/^agt_/);
    expect(body.agent.allowedTargets).toEqual(["agt_b"]);
    expect(body).not.toHaveProperty("secretHash");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: writeHeaders(),
      payload: { machineId: "m1", project: "aw", displayName: "Agent B" },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("轮换返回新密钥,未知 id 404", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: writeHeaders(),
      payload: { machineId: "missing", project: "aw", displayName: "A" },
    });
    expect(created.statusCode).toBe(404);

    db.prepare(
      "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1','h','linux','1','hash','active',0)",
    ).run();
    const agent = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: writeHeaders(),
      payload: { machineId: "m1", project: "aw", displayName: "A" },
    });
    const agentId = (agent.json() as { agent: { id: string } }).agent.id;

    const rotated = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/rotate`,
      headers: writeHeaders(),
    });
    expect(rotated.statusCode).toBe(200);
    expect(typeof (rotated.json() as { secret: string }).secret).toBe("string");

    const unknown = await app.inject({
      method: "POST",
      url: "/api/agents/agt_missing/rotate",
      headers: writeHeaders(),
    });
    expect(unknown.statusCode).toBe(404);
  });
});
