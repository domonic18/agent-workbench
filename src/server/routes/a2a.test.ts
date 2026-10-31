import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { buildApp } from "../app.js";

const DEADLINE = "2026-10-30T12:00:00Z";

interface Fixture {
  db: Db;
  agents: Record<string, string>;
}

function prepare(): Fixture {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const ids = ["agt_a", "agt_b", "agt_c"];
  const secrets = ["secret-a", "secret-b", "secret-c"];
  let idSeq = 0;
  let secretSeq = 0;
  const identity = createIdentityService({
    db,
    newAgentId: () => ids[idSeq++] ?? "agt_x",
    newSecret: () => secrets[secretSeq++] ?? "secret-x",
  });
  identity.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
  const agentA = identity.registerAgent({
    machineId: "m1",
    project: "pa",
    displayName: "Agent A",
    allowedTargets: ["agt_b"],
  });
  const agentB = identity.registerAgent({
    machineId: "m1",
    project: "pb",
    displayName: "Agent B",
    allowedTargets: ["agt_a"],
  });
  const agentC = identity.registerAgent({
    machineId: "m1",
    project: "pc",
    displayName: "Agent C",
    allowedTargets: ["agt_a"],
  });
  for (const [id, assignee] of [
    ["tsk_a", agentA.agent.id],
    ["tsk_b", agentB.agent.id],
  ] as const) {
    db.prepare(
      `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
       VALUES (?, ?, 'console', ?, 'aw', 'exec', 'running', 'a2a', 0, 0)`,
    ).run(id, id, assignee);
  }
  return {
    db,
    agents: {
      [agentA.agent.id]: agentA.secret,
      [agentB.agent.id]: agentB.secret,
      [agentC.agent.id]: agentC.secret,
    },
  };
}

describe("a2a 路由", () => {
  let fixture: Fixture;
  let app: FastifyInstance;
  let keySeq = 0;

  function auth(agentId: string): Record<string, string> {
    return { authorization: `Bearer ${agentId}.${fixture.agents[agentId]}` };
  }

  function messageBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      task_id: "tsk_a",
      to: "agt_b",
      intent: "request",
      summary: "需要一份接口契约",
      expect: "OpenAPI 片段",
      deadline: DEADLINE,
      ...overrides,
    };
  }

  beforeEach(() => {
    fixture = prepare();
    app = buildApp({ logLevel: "silent", db: fixture.db });
  });

  afterEach(async () => {
    await app.close();
    fixture.db.close();
  });

  it("无 Bearer 401;缺 Idempotency-Key 422", async () => {
    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/a2a/messages",
      headers: { "idempotency-key": "k1" },
      payload: messageBody(),
    });
    expect(unauthorized.statusCode).toBe(401);

    const noKey = await app.inject({
      method: "POST",
      url: "/api/a2a/messages",
      headers: auth("agt_a"),
      payload: messageBody(),
    });
    expect(noKey.statusCode).toBe(422);
  });

  it("发送返回 msg_id / thread_id / round,同幂等键返回同一 msg_id", async () => {
    const headers = { ...auth("agt_a"), "idempotency-key": `k-${++keySeq}` };
    const first = await app.inject({
      method: "POST",
      url: "/api/a2a/messages",
      headers,
      payload: messageBody(),
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { msg_id: string; thread_id: string; round: number };
    expect(firstBody.msg_id).toMatch(/^msg_/);
    expect(firstBody.thread_id).toMatch(/^thr_/);
    expect(firstBody.round).toBe(1);

    const again = await app.inject({
      method: "POST",
      url: "/api/a2a/messages",
      headers,
      payload: messageBody({ summary: "重复请求" }),
    });
    expect(again.statusCode).toBe(201);
    expect((again.json() as { msg_id: string }).msg_id).toBe(firstBody.msg_id);
  });

  it("目标不在白名单 403 并回带可达目标", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/a2a/messages",
      headers: { ...auth("agt_a"), "idempotency-key": `k-${++keySeq}` },
      payload: messageBody({ to: "agt_c" }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "FORBIDDEN", detail: { allowedTargets: ["agt_b"] } },
    });
  });

  it("信封缺字段 422 并列出缺失项", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/a2a/messages",
      headers: { ...auth("agt_a"), "idempotency-key": `k-${++keySeq}` },
      payload: messageBody({ expect: "", deadline: "" }),
    });
    expect(response.statusCode).toBe(422);
    const detail = (response.json() as { error: { detail: { field: string }[] } }).error.detail;
    expect(detail.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["expect", "deadline"]),
    );
  });

  it("inbox 立即取件;跨 Agent 拉取 403", async () => {
    await app.inject({
      method: "POST",
      url: "/api/a2a/messages",
      headers: { ...auth("agt_a"), "idempotency-key": `k-${++keySeq}` },
      payload: messageBody(),
    });

    const stolen = await app.inject({
      method: "GET",
      url: "/api/a2a/inbox?agent_id=agt_a&wait=0",
      headers: auth("agt_b"),
    });
    expect(stolen.statusCode).toBe(403);

    const first = await app.inject({
      method: "GET",
      url: "/api/a2a/inbox?wait=0",
      headers: auth("agt_b"),
    });
    expect(first.statusCode).toBe(200);
    const body = first.json() as { items: { msg_id: string; from: string }[]; nextCursor: unknown };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ from: "agt_a" });
    expect(body.nextCursor).toBeNull();

    const second = await app.inject({
      method: "GET",
      url: "/api/a2a/inbox?wait=0",
      headers: auth("agt_b"),
    });
    expect((second.json() as { items: unknown[] }).items).toEqual([]);
  });

  it("ACK request 必带 task_id,成功后写 parent_task_id", async () => {
    const sent = await app.inject({
      method: "POST",
      url: "/api/a2a/messages",
      headers: { ...auth("agt_a"), "idempotency-key": `k-${++keySeq}` },
      payload: messageBody(),
    });
    const msgId = (sent.json() as { msg_id: string }).msg_id;
    await app.inject({ method: "GET", url: "/api/a2a/inbox?wait=0", headers: auth("agt_b") });

    const missing = await app.inject({
      method: "POST",
      url: `/api/a2a/inbox/${msgId}/ack`,
      headers: auth("agt_b"),
      payload: {},
    });
    expect(missing.statusCode).toBe(422);

    const notMine = await app.inject({
      method: "POST",
      url: `/api/a2a/inbox/${msgId}/ack`,
      headers: auth("agt_a"),
      payload: { task_id: "tsk_b" },
    });
    expect(notMine.statusCode).toBe(403);

    const acked = await app.inject({
      method: "POST",
      url: `/api/a2a/inbox/${msgId}/ack`,
      headers: auth("agt_b"),
      payload: { task_id: "tsk_b" },
    });
    expect(acked.statusCode).toBe(200);
    expect(
      fixture.db.prepare("SELECT parent_task_id AS p FROM task WHERE id = 'tsk_b'").get(),
    ).toEqual({ p: "tsk_a" });

    const empty = await app.inject({
      method: "GET",
      url: "/api/a2a/inbox?wait=0",
      headers: auth("agt_b"),
    });
    expect((empty.json() as { items: unknown[] }).items).toEqual([]);
  });
});
