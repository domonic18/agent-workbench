import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertMessage, insertThread } from "../../store/repositories/a2a.js";
import { insertAssembly } from "../../store/repositories/assembly.js";
import { insertMachine } from "../../store/repositories/machine.js";
import { insertAgent } from "../../store/repositories/agent.js";
import { insertOutbox } from "../../store/repositories/outbox.js";
import { insertTask } from "../../store/repositories/task.js";
import { insertWorkerInboxIfNew } from "../../store/repositories/work-inbox.js";
import { insertWorkItem } from "../../store/repositories/work-item.js";
import { insertWorkTriggerIfNew } from "../../store/repositories/work-trigger.js";
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

describe("Agent 生命周期路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let keySeq = 0;

  function writeHeaders(key = `key-${++keySeq}`): Record<string, string> {
    return { cookie, "x-requested-with": "fetch", "idempotency-key": key };
  }

  beforeEach(async () => {
    db = await openDatabase();
    await ensureConsoleCredential(db, PASSWORD);
    await insertMachine(db, {
      id: "m1",
      hostname: "host-a",
      os: "darwin",
      collectorVersion: "1.0.0",
      collectorSecretHash: "h",
      createdAt: AT,
    });
    await insertAgent(db, {
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
    await insertAgent(db, {
      id: "a2",
      machineId: "m1",
      runtime: "claude_code",
      project: "p2",
      displayName: "Agent Two",
      secretHash: "h",
      feishuAppId: null,
      allowedTargetsJson: "[]",
      createdAt: AT,
    });
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

  /** 铺一套关联数据:派工信箱、触发事实、任务、A2A 线程与消息 */
  async function seedRelations(): Promise<void> {
    await insertWorkItem(db, {
      id: "wi1",
      project: "p1",
      kind: "bug_fix",
      title: "修一个 bug",
      expectedResult: "修好",
      scopeJson: "{}",
      originTriggerId: null,
      authorizationKind: "none",
      authorizationRef: null,
      policyVersion: "v1",
      createdAt: AT,
    });
    await insertWorkTriggerIfNew(db, {
      id: "wt1",
      source: "github",
      sourceEventId: "ev1",
      kind: "issue.opened",
      actorJson: "{}",
      project: "p1",
      threadRefsJson: "[]",
      payloadJson: "{}",
      refsJson: "[]",
      authorizationRef: null,
      occurredAt: AT,
      receivedAt: AT,
    });
    await db.run("UPDATE work_trigger SET target_agent_id = 'a1' WHERE id = 'wt1'");
    await insertWorkerInboxIfNew(db, {
      id: "in1",
      kind: "assignment",
      workItemId: "wi1",
      triggerId: "wt1",
      targetAgentId: "a1",
      idempotencyKey: "ib-1",
      payloadJson: "{}",
      createdAt: AT,
    });
    await insertTask(db, {
      id: "t1",
      title: "任务一",
      assigner: "human",
      assignee: "a1",
      project: "p1",
      parentTaskId: null,
      origin: "a2a",
      deadlineAt: null,
      output: null,
      createdAt: AT,
    });
    await insertThread(db, {
      id: "th1",
      initiatorTaskId: "t1",
      initiatorAgent: "a1",
      responderAgent: "a2",
      createdAt: AT,
    });
    await insertMessage(db, {
      id: "msg1",
      threadId: "th1",
      taskId: "t1",
      round: 1,
      replyToMsgId: null,
      fromAgent: "a1",
      toAgent: "a2",
      intent: "request",
      summary: "请处理",
      expect: "回复",
      deadlineAt: null,
      refsJson: "[]",
      authTicket: null,
      createdAt: AT,
    });
    await insertOutbox(db, {
      id: "ob1",
      idempotencyKey: "ob-key-1",
      channel: "pull",
      deliveryClass: "business",
      taskId: "t1",
      msgId: "msg1",
      kind: "a2a",
      payloadHash: "h",
      payloadJson: "{}",
      availableAt: AT,
      createdAt: AT,
    });
    await db.run(
      `INSERT INTO knowledge_entry
         (id, path, title, summary, category, status, source_task_id, source_agent_id,
          content_hash, embedding_status, created_at, updated_at)
       VALUES ('ke1', 'notes/x.md', '一条知识', '', '', 'active', 't1', 'a1', 'h', 'ready', ?, ?)`,
      AT, AT,
    );
    await db.run(
      `INSERT INTO tool_call_log
         (run_id, agent_id, task_id, tool, args_hash, level, verdict, occurred_at)
       VALUES ('r1', 'a1', 't1', 'bash', 'h', 'L0', 'allow', ?)`,
      AT,
    );
  }

  it("未登录不能改也不能删", async () => {
    expect((await app.inject({ method: "GET", url: "/api/agents/a1/delete-impact" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "PATCH", url: "/api/agents/a1", payload: { displayName: "x" } }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/api/agents/a1" })).statusCode).toBe(401);
  });

  it("改档案:改名、改项目、启停", async () => {
    const renamed = await app.inject({
      method: "PATCH",
      url: "/api/agents/a1",
      headers: writeHeaders(),
      payload: { displayName: "改名后的 Agent" },
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as { agent: { displayName: string } }).agent.displayName).toBe(
      "改名后的 Agent",
    );

    const moved = await app.inject({
      method: "PATCH",
      url: "/api/agents/a1",
      headers: writeHeaders(),
      payload: { project: "p-renamed" },
    });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as { agent: { project: string } }).agent.project).toBe("p-renamed");

    const disabled = await app.inject({
      method: "PATCH",
      url: "/api/agents/a1",
      headers: writeHeaders(),
      payload: { status: "disabled" },
    });
    expect(disabled.statusCode).toBe(200);
    expect((disabled.json() as { agent: { status: string } }).agent.status).toBe("disabled");
  });

  it("改档案:空改动与同机器同项目冲突都被拒", async () => {
    const empty = await app.inject({
      method: "PATCH",
      url: "/api/agents/a1",
      headers: writeHeaders(),
      payload: {},
    });
    expect(empty.statusCode).toBe(422);

    const clash = await app.inject({
      method: "PATCH",
      url: "/api/agents/a1",
      headers: writeHeaders(),
      payload: { project: "p2" },
    });
    expect(clash.statusCode).toBe(409);
  });

  it("删除前给影响清单:销毁/解绑/保留三组计数", async () => {
    await seedRelations();
    const response = await app.inject({
      method: "GET",
      url: "/api/agents/a1/delete-impact",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      preview: {
        impact: {
          destroyed: Record<string, number>;
          detached: Record<string, number>;
          retained: Record<string, number>;
        };
        bootstrapPrimary: boolean;
      };
    };
    expect(body.preview.impact.destroyed).toMatchObject({
      workerInbox: 1,
      a2aThread: 1,
      a2aMessage: 1,
      outboxPull: 1,
    });
    expect(body.preview.impact.detached).toMatchObject({ workTrigger: 1, knowledgeEntry: 1 });
    expect(body.preview.impact.retained).toMatchObject({ task: 1, toolCallLog: 1 });
    expect(body.preview.bootstrapPrimary).toBe(false);
  });

  it("硬删除:级联清干净,墓碑留名,纯文本列仍可读", async () => {
    await seedRelations();
    const response = await app.inject({
      method: "DELETE",
      url: "/api/agents/a1",
      headers: writeHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "a1", replayed: false });

    expect(await db.get("SELECT id FROM agent WHERE id = 'a1'")).toBeUndefined();
    expect(await db.get("SELECT id FROM worker_inbox WHERE target_agent_id = 'a1'")).toBeUndefined();
    expect(await db.get("SELECT id FROM a2a_message WHERE id = 'msg1'")).toBeUndefined();
    expect(await db.get("SELECT id FROM a2a_thread WHERE id = 'th1'")).toBeUndefined();
    expect(await db.get("SELECT id FROM outbox WHERE msg_id = 'msg1'")).toBeUndefined();
    // 可空引用被断开,事实本身保留
    const trigger = await db.get<{ targetAgentId: string | null }>(
      'SELECT target_agent_id AS "targetAgentId" FROM work_trigger WHERE id = \'wt1\'',
    );
    expect(trigger?.targetAgentId).toBeNull();
    const knowledge = await db.get<{ sourceAgentId: string | null }>(
      'SELECT source_agent_id AS "sourceAgentId" FROM knowledge_entry WHERE id = \'ke1\'',
    );
    expect(knowledge?.sourceAgentId).toBeNull();
    // 追加式审计与任务保留
    expect(await db.get("SELECT id FROM tool_call_log WHERE agent_id = 'a1'")).toBeDefined();
    expect(await db.get("SELECT id FROM task WHERE assignee = 'a1'")).toBeDefined();
    // 孤儿事项兜底(M3.10-4):唯一投递行被删的 open 事项标记需人,不再无声饿死
    const orphan = await db.get<{ attention: string; nextAction: string | null }>(
      'SELECT attention, next_action AS "nextAction" FROM work_item WHERE id = \'wi1\'',
    );
    expect(orphan?.attention).toBe("person");
    expect(orphan?.nextAction).toContain("已删除");
    const orphanEvent = await db.get<{ kind: string }>(
      "SELECT kind FROM work_item_event WHERE work_item_id = 'wi1'",
    );
    expect(orphanEvent?.kind).toBe("orphaned");
    // 墓碑留名
    const tomb = await db.get<{ displayName: string }>(
      'SELECT display_name AS "displayName" FROM agent_tombstone WHERE id = \'a1\'',
    );
    expect(tomb?.displayName).toBe("Agent One");
  });

  it("删除只孤儿化失去全部投递行的事项:仍有他 Agent 的行不标记", async () => {
    await seedRelations();
    await insertWorkerInboxIfNew(db, {
      id: "in2",
      kind: "assignment",
      workItemId: "wi1",
      triggerId: "wt1",
      targetAgentId: "a2",
      idempotencyKey: "ib-2",
      payloadJson: "{}",
      createdAt: AT,
    });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/agents/a1",
      headers: writeHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const item = await db.get<{ attention: string }>(
      'SELECT attention FROM work_item WHERE id = \'wi1\'',
    );
    expect(item?.attention).toBe("none");
    expect(
      await db.get("SELECT kind FROM work_item_event WHERE work_item_id = 'wi1' AND kind = 'orphaned'"),
    ).toBeUndefined();
  });

  it("删除后任务列表显示「已删除 Agent X」", async () => {
    await seedRelations();
    await app.inject({
      method: "DELETE",
      url: "/api/agents/a1",
      headers: writeHeaders(),
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ id: string; assignee_label: string }> };
    const task = body.items.find((item) => item.id === "t1");
    expect(task?.assignee_label).toBe("已删除 Agent One");
  });

  it("默认路由主责不能直接删,指定接替者才放行", async () => {
    await insertAssembly(db, { primaryAgentId: "a1", workKind: "bug_fix", assembledAt: AT });

    const blocked = await app.inject({
      method: "DELETE",
      url: "/api/agents/a1",
      headers: writeHeaders(),
    });
    expect(blocked.statusCode).toBe(409);

    const ok = await app.inject({
      method: "DELETE",
      url: "/api/agents/a1",
      headers: writeHeaders(),
      payload: { reassignBootstrapPrimaryTo: "a2" },
    });
    expect(ok.statusCode).toBe(200);
    const assembly = await db.get<{ primaryAgentId: string }>(
      'SELECT primary_agent_id AS "primaryAgentId" FROM bootstrap_assembly WHERE id = 1',
    );
    expect(assembly?.primaryAgentId).toBe("a2");
  });

  it("接替者不存在或已停用时拒绝", async () => {
    await insertAssembly(db, { primaryAgentId: "a1", workKind: "bug_fix", assembledAt: AT });

    const missing = await app.inject({
      method: "DELETE",
      url: "/api/agents/a1",
      headers: writeHeaders(),
      payload: { reassignBootstrapPrimaryTo: "a-nope" },
    });
    expect(missing.statusCode).toBe(404);

    await db.run("UPDATE agent SET status = 'disabled' WHERE id = 'a2'");
    const disabled = await app.inject({
      method: "DELETE",
      url: "/api/agents/a1",
      headers: writeHeaders(),
      payload: { reassignBootstrapPrimaryTo: "a2" },
    });
    expect(disabled.statusCode).toBe(422);
  });

  it("同一幂等键重放删除:不重复执行,返回 replayed", async () => {
    const key = "del-key-1";
    const first = await app.inject({
      method: "DELETE",
      url: "/api/agents/a1",
      headers: writeHeaders(key),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ replayed: false });

    const second = await app.inject({
      method: "DELETE",
      url: "/api/agents/a1",
      headers: writeHeaders(key),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ replayed: true });
  });

  it("缺幂等键的写操作被拒", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/api/agents/a1",
      headers: { cookie, "x-requested-with": "fetch" },
    });
    expect(response.statusCode).toBe(422);
  });
});
