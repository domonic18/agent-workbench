import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { insertAgent, insertMachine } from "../../store/repositories/identity.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";
const AT = 1_700_000_000_000;

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

describe("overview 路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    runMigrations(db);
    ensureConsoleCredential(db, PASSWORD);
    app = buildApp({ logLevel: "silent", db, now: () => AT });
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

  it("未登录返回 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/overview" });
    expect(response.statusCode).toBe(401);
  });

  it("空库返回全零指标与空列表", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/overview",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      revision: 0,
      generatedAt: AT,
      metrics: {
        runningAgents: 0,
        runningTasks: 0,
        todayTokens: 0,
        pendingApprovals: 0,
        heartbeatTimeouts: 0,
      },
      agents: [],
    });
  });

  it("返回 Agent 列表与心跳状态", async () => {
    insertMachine(db, {
      id: "m1",
      hostname: "host",
      os: "darwin",
      collectorVersion: "1.0.0",
      collectorSecretHash: "h",
      createdAt: AT,
    });
    await db.run("UPDATE machine SET last_seen_at = ? WHERE id = 'm1'", AT - 60_000);
    insertAgent(db, {
      id: "a1",
      machineId: "m1",
      project: "p1",
      displayName: "Agent One",
      secretHash: "h",
      feishuAppId: null,
      allowedTargetsJson: "[]",
      createdAt: AT,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/overview",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { revision: number; agents: unknown[] };
    expect(body.revision).toBeGreaterThan(0);
    expect(body.agents).toEqual([
      expect.objectContaining({
        id: "a1",
        displayName: "Agent One",
        heartbeat: "ok",
        running: false,
        todayTokens: 0,
      }),
    ]);
  });
});
