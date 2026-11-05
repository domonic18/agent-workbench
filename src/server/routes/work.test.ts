import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertTask } from "../../store/repositories/task.js";
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

describe("work 读侧路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let keySeq = 0;

  function writeHeaders(key = `work-read-key-${++keySeq}`): Record<string, string> {
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
    // 读侧断言 routed 前置:试点 Agent 必须已注册,否则触发走 needs_person
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
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  /** 同 Thread 再触发会 owner 直通成 input 不建新事项,需要第二条事项时换 externalKey */
  async function triggerWorkItem(sourceEventId: string, externalKey = "BUG-1"): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/work/triggers",
      headers: writeHeaders(),
      payload: triggerBody({
        sourceEventId,
        threadRefs: [{ source: "bug", externalKind: "issue", externalKey }],
      }),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { workItem: { id: string } | null };
    expect(body.workItem).not.toBeNull();
    return body.workItem!.id;
  }

  it("未登录 401,非法枚举过滤 422", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/api/work-items" })).statusCode,
    ).toBe(401);

    const bad = await app.inject({
      method: "GET",
      url: "/api/work-items?stage=whatever",
      headers: { cookie },
    });
    expect(bad.statusCode).toBe(422);

    const badCursor = await app.inject({
      method: "GET",
      url: "/api/work-items?cursor=broken",
      headers: { cookie },
    });
    expect(badCursor.statusCode).toBe(422);
  });

  it("列表支持过滤与游标翻页", async () => {
    const first = await triggerWorkItem("read-evt-1");
    await triggerWorkItem("read-evt-2", "BUG-2");

    const all = await app.inject({
      method: "GET",
      url: "/api/work-items",
      headers: { cookie },
    });
    expect(all.statusCode).toBe(200);
    const listBody = all.json() as {
      items: { id: string; kind: string }[];
      nextCursor: string | null;
    };
    expect(listBody.items).toHaveLength(2);
    expect(listBody.items.every((item) => item.kind === "bug_fix")).toBe(true);
    expect(listBody.nextCursor).toBeNull();

    const paged = await app.inject({
      method: "GET",
      url: "/api/work-items?limit=1",
      headers: { cookie },
    });
    const pageBody = paged.json() as { items: { id: string }[]; nextCursor: string };
    expect(pageBody.items).toHaveLength(1);
    expect(pageBody.nextCursor).not.toBeNull();

    const next = await app.inject({
      method: "GET",
      url: `/api/work-items?limit=1&cursor=${encodeURIComponent(pageBody.nextCursor)}`,
      headers: { cookie },
    });
    const nextBody = next.json() as { items: { id: string }[]; nextCursor: string | null };
    expect(nextBody.items).toHaveLength(1);
    expect(nextBody.items[0]!.id).not.toBe(pageBody.items[0]!.id);
    expect(nextBody.nextCursor).toBeNull();

    const filtered = await app.inject({
      method: "GET",
      url: "/api/work-items?attention=none&kind=bug_fix",
      headers: { cookie },
    });
    expect(((filtered.json() as { items: unknown[] }).items)).toHaveLength(2);

    const empty = await app.inject({
      method: "GET",
      url: "/api/work-items?kind=nonexistent",
      headers: { cookie },
    });
    expect(((empty.json() as { items: unknown[] }).items)).toHaveLength(0);
    expect(first).toBeTypeOf("string");
  });

  it("详情含 Mandate 快照、投递箱与 Thread 关联,未知事项 404", async () => {
    const workItemId = await triggerWorkItem("read-evt-detail");

    const detail = await app.inject({
      method: "GET",
      url: `/api/work-items/${workItemId}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      workItem: {
        expectedResult: string;
        scope: unknown;
        authorization: { kind: string };
        policyVersion: string;
      };
      inbox: { kind: string; status: string }[];
      threads: { source: string; externalKey: string; mode: string }[];
      tasks: unknown[];
      runs: unknown[];
    };
    expect(body.workItem.expectedResult).toBeTypeOf("string");
    expect(body.workItem.scope).toBeTypeOf("object");
    expect(body.workItem.authorization.kind).toBeTypeOf("string");
    expect(body.workItem.policyVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(body.inbox).toHaveLength(1);
    expect(body.inbox[0]).toMatchObject({ kind: "assignment", status: "pending" });
    expect(body.threads[0]).toMatchObject({
      source: "bug",
      externalKey: "BUG-1",
      mode: "owner",
    });
    expect(body.tasks).toEqual([]);
    expect(body.runs).toEqual([]);

    await insertTask(db, {
      id: "task-read-1",
      title: "试点任务",
      assigner: "router",
      assignee: "workbuddy-pilot",
      project: "workbuddy-pilot",
      parentTaskId: null,
      origin: "work_item",
      workItemId,
      deadlineAt: null,
      output: null,
      createdAt: NOW,
    });
    const afterTask = await app.inject({
      method: "GET",
      url: `/api/work-items/${workItemId}`,
      headers: { cookie },
    });
    const afterBody = afterTask.json() as { tasks: { id: string; origin: string }[] };
    expect(afterBody.tasks).toEqual([
      expect.objectContaining({ id: "task-read-1", origin: "work_item" }),
    ]);

    const missing = await app.inject({
      method: "GET",
      url: "/api/work-items/wim_missing",
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("事件时间线支持 seq 游标增量", async () => {
    const workItemId = await triggerWorkItem("read-evt-events");

    const snapshot = await app.inject({
      method: "GET",
      url: `/api/work-items/${workItemId}/events`,
      headers: { cookie },
    });
    expect(snapshot.statusCode).toBe(200);
    const snapshotBody = snapshot.json() as {
      items: { seq: number; kind: string; payload: unknown }[];
      nextCursor: number | null;
    };
    expect(snapshotBody.items.length).toBeGreaterThan(0);
    expect(snapshotBody.items[0]!.kind).toBe("routed");
    expect(snapshotBody.nextCursor).toBeNull();

    const firstPage = await app.inject({
      method: "GET",
      url: `/api/work-items/${workItemId}/events?limit=1`,
      headers: { cookie },
    });
    const pageBody = firstPage.json() as {
      items: { seq: number }[];
      nextCursor: number | null;
    };
    expect(pageBody.items).toHaveLength(1);
    expect(pageBody.nextCursor).toBe(pageBody.items[0]!.seq);

    const incremental = await app.inject({
      method: "GET",
      url: `/api/work-items/${workItemId}/events?cursor=${pageBody.nextCursor}`,
      headers: { cookie },
    });
    const incrementalBody = incremental.json() as { items: { seq: number }[]; nextCursor: number | null };
    expect(incrementalBody.items).toHaveLength(
      snapshotBody.items.length - pageBody.items.length,
    );
    expect(incrementalBody.items.every((e) => e.seq > pageBody.items[0]!.seq)).toBe(true);
    expect(incrementalBody.nextCursor).toBeNull();
  });
});

describe("GET /api/work/inbox(Agent Bearer)", () => {
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
});
