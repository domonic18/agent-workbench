import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertMachine } from "../../store/repositories/machine.js";
import { insertAgent } from "../../store/repositories/agent.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret1234567";
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
    db = await openDatabase();
    await ensureConsoleCredential(db, PASSWORD);
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
    await db.close();
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
    await insertMachine(db, {
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
      runtime: "claude_code",
      project: "p1",
      displayName: "Agent One",
      secretHash: "h",
      feishuAppId: null,
      allowedTargetsJson: "[]",
      createdAt: AT,
    });
    insertAgent(db, {
      id: "a2",
      machineId: null,
      runtime: "workbuddy",
      project: "p2",
      displayName: "Agent Two",
      secretHash: "h",
      feishuAppId: null,
      allowedTargetsJson: "[]",
      createdAt: AT,
    });
    // 同机两条 running run(idle 窗口内):活跃会话按机器聚合成 2;窗口外的旧 run 不算
    for (const run of [
      { id: "run-live-1", seen: AT },
      { id: "run-live-2", seen: AT - 60_000 },
      { id: "run-stale", seen: AT - 31 * 60_000 },
    ]) {
      await db.run(
        `INSERT INTO agent_run (id, agent_id, machine, project, stream_id, status, started_at, last_seen_at)
         VALUES (?, 'a1', 'm1', 'p1', ?, 'running', ?, ?)`,
        run.id, run.id, run.seen, run.seen,
      );
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/overview",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      revision: number;
      agents: Array<{ id: string; activeSessions: number | null }>;
    };
    expect(body.revision).toBeGreaterThan(0);
    const byId = new Map(body.agents.map((agent) => [agent.id, agent]));
    expect(byId.get("a1")).toMatchObject({
      id: "a1",
      displayName: "Agent One",
      heartbeat: "ok",
      running: true,
      todayTokens: 0,
      activeSessions: 2,
    });
    // 机器无关运行时没有本机会话概念,不显示数字
    expect(byId.get("a2")?.activeSessions).toBeNull();
  });
});
