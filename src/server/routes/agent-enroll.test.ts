import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";

interface Fixture {
  db: Db;
  app: FastifyInstance;
  cookie: string;
  agentId: string;
  /** 注册时拿到的明文密钥 */
  secret: string;
}

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

async function prepare(): Promise<Fixture> {
  const db = await openDatabase();
  await ensureConsoleCredential(db, PASSWORD);
  const identity = createIdentityService({
    db,
    newAgentId: () => "agt_e1",
    newSecret: () => "secret-e1",
  });
  await identity.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
  const { agent, secret } = await identity.registerAgent({
    machineId: "m1",
    project: "pa",
    displayName: "自助接入方",
  });

  const app = buildApp({ db, logLevel: "silent" });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  return { db, app, cookie: cookieOf(login), agentId: agent.id, secret };
}

async function issueToken(fixture: Fixture): Promise<string> {
  const response = await fixture.app.inject({
    method: "POST",
    url: `/api/agents/${fixture.agentId}/enroll-token`,
    headers: { cookie: fixture.cookie, "x-requested-with": "aw-web", "idempotency-key": "k1" },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.app.close();
  await fixture?.db.close();
  fixture = undefined;
});

describe("Agent 接入令牌", () => {
  it("未登录签发 401", async () => {
    fixture = await prepare();
    const response = await fixture.app.inject({
      method: "POST",
      url: `/api/agents/${fixture.agentId}/enroll-token`,
      headers: { "x-requested-with": "aw-web", "idempotency-key": "k1" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("Agent 不存在时签发 404", async () => {
    fixture = await prepare();
    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/agents/agt_none/enroll-token",
      headers: { cookie: fixture.cookie, "x-requested-with": "aw-web", "idempotency-key": "k1" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("令牌兑换出新密钥,且旧密钥随即失效", async () => {
    fixture = await prepare();
    const token = await issueToken(fixture);
    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/agent-enroll",
      payload: { token },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { agent_id: string; secret: string; authorization: string };
    expect(body.agent_id).toBe(fixture.agentId);
    expect(body.secret).not.toBe(fixture.secret);
    expect(body.authorization).toBe(`Bearer ${fixture.agentId}.${body.secret}`);

    // 换到的密钥能用,旧密钥不能再用
    const peers = await fixture.app.inject({
      method: "GET",
      url: "/api/agent/peers",
      headers: { authorization: body.authorization },
    });
    expect(peers.statusCode).toBe(200);
    const stale = await fixture.app.inject({
      method: "GET",
      url: "/api/agent/peers",
      headers: { authorization: `Bearer ${fixture.agentId}.${fixture.secret}` },
    });
    expect(stale.statusCode).toBe(401);
  });

  it("令牌只能用一次,再用返回 410", async () => {
    fixture = await prepare();
    const token = await issueToken(fixture);
    const first = await fixture.app.inject({
      method: "POST",
      url: "/api/agent-enroll",
      payload: { token },
    });
    expect(first.statusCode).toBe(201);
    const second = await fixture.app.inject({
      method: "POST",
      url: "/api/agent-enroll",
      payload: { token },
    });
    expect(second.statusCode).toBe(410);
  });

  it("无此令牌返回 401,缺令牌返回 422", async () => {
    fixture = await prepare();
    const unknown = await fixture.app.inject({
      method: "POST",
      url: "/api/agent-enroll",
      payload: { token: "ott_nope" },
    });
    expect(unknown.statusCode).toBe(401);
    const missing = await fixture.app.inject({
      method: "POST",
      url: "/api/agent-enroll",
      payload: {},
    });
    expect(missing.statusCode).toBe(422);
  });
});
