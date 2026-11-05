import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";
const NOW = 5_000;

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

function triggerBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "bug",
    sourceEventId: "evt-1",
    kind: "submitted",
    occurredAt: NOW,
    actor: { user: "tester" },
    project: "workbuddy-pilot",
    threadRefs: [{ source: "bug", externalKind: "issue", externalKey: "BUG-1" }],
    payload: { title: "登录页 500" },
    refs: [],
    ...overrides,
  };
}

describe("work 触发路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let keySeq = 0;

  function writeHeaders(key = `work-key-${++keySeq}`): Record<string, string> {
    return { cookie, "x-requested-with": "fetch", "idempotency-key": key };
  }

  beforeEach(async () => {
    db = await prepare();
    app = buildApp({ logLevel: "silent", db, now: () => NOW });
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

  async function registerPilotAgent(): Promise<{ id: string; secret: string }> {
    const response = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: writeHeaders(),
      payload: {
        runtime: "workbuddy",
        key: "workbuddy-pilot",
        project: "workbuddy-pilot",
        displayName: "Pilot Worker",
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { agent: { id: string; key: string }; secret: string };
    expect(body.agent.key).toBe("workbuddy-pilot");
    return { id: body.agent.id, secret: body.secret };
  }

  it("未登录 401,缺幂等键 422,非法 body 422", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/work/triggers",
          headers: { "x-requested-with": "fetch", "idempotency-key": "k" },
          payload: triggerBody(),
        })
      ).statusCode,
    ).toBe(401);

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/work/triggers",
          headers: { cookie, "x-requested-with": "fetch" },
          payload: triggerBody(),
        })
      ).statusCode,
    ).toBe(422);

    const bad = await app.inject({
      method: "POST",
      url: "/api/work/triggers",
      headers: writeHeaders(),
      payload: triggerBody({ occurredAt: "yesterday" }),
    });
    expect(bad.statusCode).toBe(422);
    expect((bad.json() as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
  });

  it("试点项目触发 routed 到注册表 Agent,重放返回首次处置", async () => {
    const agent = await registerPilotAgent();

    const first = await app.inject({
      method: "POST",
      url: "/api/work/triggers",
      headers: writeHeaders(),
      payload: triggerBody(),
    });
    expect(first.statusCode).toBe(200);
    const body = first.json() as {
      replayed: boolean;
      trigger: { disposition: string; targetAgentId: string | null };
      workItem: { id: string; kind: string } | null;
      inboxIds: string[];
    };
    expect(body.replayed).toBe(false);
    expect(body.trigger.disposition).toBe("routed");
    expect(body.trigger.targetAgentId).toBe(agent.id);
    expect(body.workItem).toMatchObject({ kind: "bug_fix" });
    expect(body.inboxIds).toHaveLength(1);

    const replay = await app.inject({
      method: "POST",
      url: "/api/work/triggers",
      headers: writeHeaders(),
      payload: triggerBody(),
    });
    expect(replay.statusCode).toBe(200);
    const replayBody = replay.json() as { replayed: boolean; inboxIds: string[] };
    expect(replayBody.replayed).toBe(true);
    expect(replayBody.inboxIds).toEqual([]);
    expect(await db.get("SELECT COUNT(*) AS n FROM work_item")).toEqual({ n: 1 });
  });

  it("试点 Agent 未注册时 target_unavailable,未登记项目 needs_person", async () => {
    const unavailable = await app.inject({
      method: "POST",
      url: "/api/work/triggers",
      headers: writeHeaders(),
      payload: triggerBody({ sourceEventId: "evt-no-agent" }),
    });
    expect(
      (unavailable.json() as { trigger: { disposition: string; reasonCode: string } }).trigger,
    ).toMatchObject({ disposition: "needs_person", reasonCode: "target_unavailable" });

    const unregistered = await app.inject({
      method: "POST",
      url: "/api/work/triggers",
      headers: writeHeaders(),
      payload: triggerBody({ sourceEventId: "evt-ghost", project: "ghost-project" }),
    });
    expect(
      (unregistered.json() as { trigger: { disposition: string; reasonCode: string } }).trigger,
    ).toMatchObject({ disposition: "needs_person", reasonCode: "no_project" });
  });
});
