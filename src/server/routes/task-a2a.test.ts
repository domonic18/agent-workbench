import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertMessage, insertThread } from "../../store/repositories/a2a.js";
import { insertOutbox } from "../../store/repositories/outbox.js";
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

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
  for (const id of ["agt_a", "agt_b"]) {
    await db.run(
      `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
       VALUES (?, 'm1', ?, ?, 'hash', 'active', '[]', 0, 0)`,
      id, id, id,
    );
  }
  for (const [id, assignee] of [
    ["tsk_a", "agt_a"],
    ["tsk_b", "agt_b"],
  ] as const) {
    await db.run(
      `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
       VALUES (?, ?, 'console', ?, 'aw', 'exec', 'running', 'a2a', 0, 0)`,
      id, id, assignee,
    );
  }
  return db;
}

async function seedThread(db: Db): Promise<void> {
  await insertThread(db, {
    id: "thr_1",
    initiatorTaskId: "tsk_a",
    initiatorAgent: "agt_a",
    responderAgent: "agt_b",
    createdAt: 1_000,
  });
  await insertMessage(db, {
    id: "msg_1",
    threadId: "thr_1",
    taskId: "tsk_a",
    round: 1,
    replyToMsgId: null,
    fromAgent: "agt_a",
    toAgent: "agt_b",
    intent: "request",
    summary: "需要接口契约",
    expect: "OpenAPI 片段",
    deadlineAt: AT + 60_000,
    refsJson: '["kb_known"]',
    authTicket: "tkt_001",
    createdAt: 1_000,
  });
  await insertMessage(db, {
    id: "msg_2",
    threadId: "thr_1",
    taskId: "tsk_b",
    round: 2,
    replyToMsgId: "msg_1",
    fromAgent: "agt_b",
    toAgent: "agt_a",
    intent: "reply",
    summary: "契约已附",
    expect: "确认",
    deadlineAt: AT + 120_000,
    refsJson: "[]",
    authTicket: null,
    createdAt: 2_000,
  });
  await insertOutbox(db, {
    id: "ob_1",
    idempotencyKey: "key_1",
    channel: "pull",
    deliveryClass: "business",
    taskId: "tsk_a",
    msgId: "msg_1",
    kind: "a2a_message",
    payloadHash: "hash",
    payloadJson: "{}",
    availableAt: 1_000,
    createdAt: 1_000,
  });
  await db.run("UPDATE outbox SET status = 'delivered' WHERE id = 'ob_1'");
}

describe("任务 A2A 线程路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = await prepare();
    await seedThread(db);
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
    const response = await app.inject({ method: "GET", url: "/api/tasks/tsk_a/a2a" });
    expect(response.statusCode).toBe(401);
  });

  it("任务不存在返回 404", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/tsk_missing/a2a",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("按线程分组返回消息、投递状态与现算线程状态", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/tsk_a/a2a",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.revision).toBe(2);
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]).toMatchObject({
      thread_id: "thr_1",
      initiator_task_id: "tsk_a",
      status: "awaiting_reply",
    });
    expect(body.threads[0].messages.map((row: { round: number }) => row.round)).toEqual([1, 2]);
    expect(body.threads[0].messages[0]).toMatchObject({
      msg_id: "msg_1",
      reply_to: null,
      from: "agt_a",
      to: "agt_b",
      intent: "request",
      refs: ["kb_known"],
      auth_ticket: "tkt_001",
      ack_at: null,
      delivery: { status: "delivered", attempts: 0, last_error: null },
    });
    expect(body.threads[0].messages[1]).toMatchObject({
      msg_id: "msg_2",
      reply_to: "msg_1",
      ack_at: null,
      delivery: null,
    });
  });

  it("接收方任务能看到同一线程", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/tsk_b/a2a",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().threads.map((row: { thread_id: string }) => row.thread_id)).toEqual([
      "thr_1",
    ]);
  });
});
