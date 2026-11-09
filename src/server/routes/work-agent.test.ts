import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret1234567";
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

describe("work Agent Bearer 路由(收件箱与挂起上报)", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let agent: { id: string; secret: string };
  let keySeq = 0;

  function writeHeaders(key = `work-inbox-key-${++keySeq}`): Record<string, string> {
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
    const register = await app.inject({
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
    expect(register.statusCode).toBe(201);
    const body = register.json() as { agent: { id: string }; secret: string };
    agent = { id: body.agent.id, secret: body.secret };
    const trigger = await app.inject({
      method: "POST",
      url: "/api/work/triggers",
      headers: writeHeaders(),
      payload: triggerBody({ sourceEventId: "inbox-evt-1" }),
    });
    expect(trigger.statusCode).toBe(200);
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  function bearer(): Record<string, string> {
    return { authorization: `Bearer ${agent.id}.${agent.secret}` };
  }

  it("peek 只看不领:返回 pending 项且行状态不变;无 peek 则领取即持租约", async () => {
    const peek = await app.inject({
      method: "GET",
      url: "/api/work/inbox?wait=0&peek=1",
      headers: bearer(),
    });
    expect(peek.statusCode).toBe(200);
    const body = peek.json() as {
      items: { inbox_id: string; kind: string; status: string; work_item_id: string }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ kind: "assignment", status: "pending" });
    const inboxId = body.items[0]!.inbox_id;
    const row = (await db.get("SELECT status, lease_until FROM worker_inbox WHERE id = ?", inboxId)) as {
      status: string;
      lease_until: number | null;
    };
    expect(row).toMatchObject({ status: "pending", lease_until: null });

    const claim = await app.inject({
      method: "GET",
      url: "/api/work/inbox?wait=0",
      headers: bearer(),
    });
    expect(claim.statusCode).toBe(200);
    const claimed = (claim.json() as { items: { status: string }[] }).items;
    expect(claimed[0]).toMatchObject({ status: "claimed" });

    const peekAfter = await app.inject({
      method: "GET",
      url: "/api/work/inbox?wait=0&peek=1",
      headers: bearer(),
    });
    expect(((peekAfter.json() as { items: unknown[] }).items)).toHaveLength(0);
  });

  it("反例:无 Bearer 401,坏密钥 401,非法 peek/wait 422", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/api/work/inbox?wait=0&peek=1" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/work/inbox?wait=0&peek=1",
          headers: { authorization: `Bearer ${agent.id}.wrong` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({ method: "GET", url: "/api/work/inbox?peek=yes", headers: bearer() })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({ method: "GET", url: "/api/work/inbox?wait=soon", headers: bearer() })
      ).statusCode,
    ).toBe(422);
  });

  it("POST /api/work/hold:首跳写 reason,重复上报幂等;非法 reason 422,无 Bearer 401", async () => {
    const peek = await app.inject({
      method: "GET",
      url: "/api/work/inbox?wait=0&peek=1",
      headers: bearer(),
    });
    const body = peek.json() as { items: { inbox_id: string }[] };
    const inboxId = body.items[0]!.inbox_id;

    const hold = await app.inject({
      method: "POST",
      url: "/api/work/hold",
      headers: bearer(),
      payload: { reason: "cwd_session_active" },
    });
    expect(hold.statusCode).toBe(200);
    const row = (await db.get("SELECT reason FROM worker_inbox WHERE id = ?", inboxId)) as {
      reason: string | null;
    };
    expect(row.reason).toBe("cwd_session_active");

    // collector 每个被挡轮次都会上报:重复上报仍 200,不炸不重复写
    const again = await app.inject({
      method: "POST",
      url: "/api/work/hold",
      headers: bearer(),
      payload: { reason: "cwd_session_active" },
    });
    expect(again.statusCode).toBe(200);

    const bad = await app.inject({
      method: "POST",
      url: "/api/work/hold",
      headers: bearer(),
      payload: { reason: "nope" },
    });
    expect(bad.statusCode).toBe(422);

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/work/hold",
          payload: { reason: "cwd_session_active" },
        })
      ).statusCode,
    ).toBe(401);
  });
});
