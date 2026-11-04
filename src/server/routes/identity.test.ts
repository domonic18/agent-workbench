import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await ensureConsoleCredential(db, PASSWORD);
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
    db = await prepare();
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

  async function registerAgent(
    machineId: string,
    project: string,
    displayName: string,
  ): Promise<{ agent: { id: string }; secret: string }> {
    const response = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: writeHeaders(),
      payload: { machineId, project, displayName },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { agent: { id: string }; secret: string };
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

    await db.run(
      "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1','h','linux','1','hash','active',0)",
    );
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

  it("保存委派白名单:仅控制台会话可写,自我与未知目标被拒", async () => {
    await app.inject({
      method: "POST",
      url: "/api/machines",
      headers: writeHeaders(),
      payload: { id: "m1", hostname: "h", os: "linux", collectorVersion: "1" },
    });
    const a = await registerAgent("m1", "a", "Agent A");
    const b = await registerAgent("m1", "b", "Agent B");
    const c = await registerAgent("m1", "c", "Agent C");
    const url = `/api/agents/${a.agent.id}/targets`;

    const saved = await app.inject({
      method: "PUT",
      url,
      headers: writeHeaders(),
      payload: { targets: [b.agent.id, c.agent.id] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      agent: { id: a.agent.id, allowedTargets: [b.agent.id, c.agent.id] },
    });

    const self = await app.inject({
      method: "PUT",
      url,
      headers: writeHeaders(),
      payload: { targets: [a.agent.id] },
    });
    expect(self.statusCode).toBe(422);

    const unknownTarget = await app.inject({
      method: "PUT",
      url,
      headers: writeHeaders(),
      payload: { targets: [b.agent.id, "agt_missing"] },
    });
    expect(unknownTarget.statusCode).toBe(422);

    const badShape = await app.inject({
      method: "PUT",
      url,
      headers: writeHeaders(),
      payload: { targets: b.agent.id },
    });
    expect(badShape.statusCode).toBe(422);

    const noKey = await app.inject({
      method: "PUT",
      url,
      headers: { cookie, "x-requested-with": "fetch" },
      payload: { targets: [] },
    });
    expect(noKey.statusCode).toBe(422);

    // Agent 自己的 Bearer 没有控制台会话,无权改自己的白名单
    const agentBearer = await app.inject({
      method: "PUT",
      url,
      headers: {
        authorization: `Bearer ${a.agent.id}.${a.secret}`,
        "x-requested-with": "fetch",
        "idempotency-key": "agent-key",
      },
      payload: { targets: [b.agent.id] },
    });
    expect(agentBearer.statusCode).toBe(401);
  });
});
