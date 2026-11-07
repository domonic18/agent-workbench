import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { insertCapability } from "../../store/repositories/capability.js";
import { findOutboxByKey } from "../../store/repositories/outbox.js";
import { bindRunTaskIfEmpty, insertRun } from "../../store/repositories/run.js";
import { insertTokenUsage } from "../../store/repositories/token-usage.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";

const FEISHU = {
  appId: "cli_test",
  appSecret: "secret",
  allowedOpenIds: [],
  approvalChatId: undefined,
  collabChatId: "oc_group",
};

interface Fixture {
  db: Db;
  secrets: Record<string, string>;
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
  const ids = ["agt_a", "agt_b"];
  const secrets = ["secret-a", "secret-b"];
  let idSeq = 0;
  let secretSeq = 0;
  const identity = createIdentityService({
    db,
    newAgentId: () => ids[idSeq++] ?? "agt_x",
    newSecret: () => secrets[secretSeq++] ?? "secret-x",
  });
  await identity.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
  const agentA = await identity.registerAgent({ machineId: "m1", project: "pa", displayName: "A" });
  const agentB = await identity.registerAgent({ machineId: "m1", project: "pb", displayName: "B" });
  return {
    db,
    secrets: {
      [agentA.agent.id]: agentA.secret,
      [agentB.agent.id]: agentB.secret,
    },
  };
}

describe("task 路由", () => {
  let fixture: Fixture;
  let app: FastifyInstance;
  let keySeq = 0;

  function auth(agentId: string): Record<string, string> {
    return { authorization: `Bearer ${agentId}.${fixture.secrets[agentId] ?? ""}` };
  }

  function headers(agentId: string): Record<string, string> {
    return {
      ...auth(agentId),
      "idempotency-key": `idem-${++keySeq}`,
      "content-type": "application/json",
    };
  }

  beforeEach(async () => {
    fixture = await prepare();
    app = buildApp({ logLevel: "silent", db: fixture.db, feishu: FEISHU });
  });

  afterEach(async () => {
    await app.close();
    await fixture.db.close();
  });

  async function createTask(agentId = "agt_a"): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: headers(agentId),
      payload: { title: "整理契约", assigner: "console", project: "aw" },
    });
    expect(response.statusCode).toBe(201);
    return response.json().task.id as string;
  }

  it("Bearer 建单 201,assignee 取自身份而非请求体", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: headers("agt_a"),
      payload: {
        title: "整理契约",
        assigner: "console",
        project: "aw",
        assignee: "agt_b",
        agent_id: "agt_b",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().task).toMatchObject({
      title: "整理契约",
      assignee: "agt_a",
      stage: "intake",
      status: "pending",
      origin: "a2a",
      parent_task_id: null,
    });
  });

  it("无 Bearer 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { "idempotency-key": "idem-x", "content-type": "application/json" },
      payload: { title: "t", assigner: "console", project: "aw" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("缺 Idempotency-Key 422", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { ...auth("agt_a"), "content-type": "application/json" },
      payload: { title: "t", assigner: "console", project: "aw" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("zod 校验失败 422 且带字段路径", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: headers("agt_a"),
      payload: { assigner: "console", project: "aw" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.detail).toEqual([
      expect.objectContaining({ path: "title" }),
    ]);
  });

  it("改自己的任务成功,改别人的 403,不存在 404", async () => {
    const taskId = await createTask();

    const owned = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: headers("agt_a"),
      payload: { status: "running" },
    });
    expect(owned.statusCode).toBe(200);
    expect(owned.json().task).toMatchObject({ status: "running", started_at: expect.any(Number) });

    const foreign = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: headers("agt_b"),
      payload: { status: "blocked" },
    });
    expect(foreign.statusCode).toBe(403);

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/tasks/tsk_404",
      headers: headers("agt_a"),
      payload: { status: "running" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("下游完成入队完成播报,根任务自动收口并入队验收播报(响应不带 notify)", async () => {
    await fixture.db.run(
        `INSERT INTO task (id, title, assigner, assignee, project, parent_task_id, stage, status, origin, created_at, updated_at)
         VALUES ('tsk_parent', '上游任务', 'console', 'agt_a', 'aw', NULL, 'exec', 'running', 'a2a', 0, 0)`,
      );
    await fixture.db.run(
        `INSERT INTO task (id, title, assigner, assignee, project, parent_task_id, stage, status, origin, created_at, updated_at)
         VALUES ('tsk_child', '下游任务', 'console', 'agt_b', 'aw', 'tsk_parent', 'exec', 'running', 'a2a', 0, 0)`,
      );

    const response = await app.inject({
      method: "PATCH",
      url: "/api/tasks/tsk_child",
      headers: headers("agt_b"),
      payload: { status: "done" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ task: { id: "tsk_child", status: "done" } });
    expect(response.json()).not.toHaveProperty("notify");

    const completion = await findOutboxByKey(fixture.db, "collab:task_done:tsk_child");
    const completionPayload = JSON.parse(completion?.payloadJson ?? "{}") as {
      chatId: string;
      card: { header: { title: { content: string }; template: string } };
      text?: string;
    };
    expect(completionPayload.chatId).toBe("oc_group");
    expect(completionPayload.card.header.title.content).toBe("〔完成〕B 已完成");
    expect(completionPayload.card.header.template).toBe("green");
    expect(completionPayload.text).toBeUndefined();
    const closure = await findOutboxByKey(fixture.db, "collab:task_closed:tsk_parent");
    const closurePayload = JSON.parse(closure?.payloadJson ?? "{}") as {
      card: { header: { title: { content: string }; template: string } };
    };
    expect(closurePayload.card.header.title.content).toBe("〔验收〕任务已闭环");
    expect(closurePayload.card.header.template).toBe("indigo");
    expect(
      await fixture.db.get("SELECT status FROM task WHERE id = 'tsk_parent'"),
    ).toEqual({ status: "done" });
  });

  it("无父任务完成不返回 notify", async () => {
    const taskId = await createTask();
    for (const status of ["running", "done"] as const) {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${taskId}`,
        headers: headers("agt_a"),
        payload: { status },
      });
      expect(response.statusCode).toBe(200);
      if (status === "done") {
        expect(response.json()).not.toHaveProperty("notify");
      }
    }
  });

  it("非法跃迁 422 带维度信息", async () => {
    const taskId = await createTask();
    const response = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: headers("agt_a"),
      payload: { status: "done" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.detail).toMatchObject({ dimension: "status" });
  });

  describe("控制台读取", () => {
    async function consoleCookie(): Promise<string> {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { password: PASSWORD },
      });
      expect(login.statusCode).toBe(200);
      return cookieOf(login);
    }

    async function seedUsage(taskId: string): Promise<void> {
      await insertRun(fixture.db, {
        id: "run_1",
        agentId: "agt_a",
        machine: "m1",
        project: "pa",
        streamId: "s1",
        startedAt: 1,
      });
      expect(await bindRunTaskIfEmpty(fixture.db, "run_1", taskId)).toBe(true);
      await insertTokenUsage(fixture.db, {
        id: "tu_1",
        agentId: "agt_a",
        taskId,
        runId: "run_1",
        provider: "anthropic",
        model: "claude",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        cacheCreationTokens: 5,
        source: "assistant_message",
        sequence: 1,
        receiptHash: "hash",
        occurredAt: Date.now(),
      });
      await insertCapability(fixture.db, {
        id: "cap_1",
        subject: "agt_a",
        target: "db.prod",
        action: "read",
        scopeJson: '{"tables":["orders"]}',
        ttlSeconds: 900,
        taskId,
        createdAt: Date.now(),
      });
    }

    it("未登录读接口统一 401", async () => {
      const taskId = await createTask();
      for (const url of ["/api/tasks", `/api/tasks/${taskId}`, `/api/tasks/${taskId}/events`]) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(401);
      }
    });

    it("列表支持过滤、游标分页与参数校验", async () => {
      await createTask("agt_a");
      await createTask("agt_a");
      await createTask("agt_b");
      const cookie = await consoleCookie();

      const all = await app.inject({
        method: "GET",
        url: "/api/tasks",
        headers: { cookie },
      });
      expect(all.statusCode).toBe(200);
      expect(all.json().items).toHaveLength(3);
      expect(all.json().nextCursor).toBeNull();

      const byB = await app.inject({
        method: "GET",
        url: "/api/tasks?assignee=agt_b",
        headers: { cookie },
      });
      expect(byB.json().items).toHaveLength(1);
      expect(byB.json().items[0].assignee).toBe("agt_b");

      const byStatus = await app.inject({
        method: "GET",
        url: "/api/tasks?status=pending",
        headers: { cookie },
      });
      expect(byStatus.json().items).toHaveLength(3);

      const page1 = await app.inject({
        method: "GET",
        url: "/api/tasks?limit=2",
        headers: { cookie },
      });
      expect(page1.json().items).toHaveLength(2);
      const cursor = page1.json().nextCursor as string;
      expect(cursor).toMatch(/^\d+:/);

      const page2 = await app.inject({
        method: "GET",
        url: `/api/tasks?limit=2&cursor=${encodeURIComponent(cursor)}`,
        headers: { cookie },
      });
      expect(page2.json().items).toHaveLength(1);
      expect(page2.json().nextCursor).toBeNull();

      const badStatus = await app.inject({
        method: "GET",
        url: "/api/tasks?status=nope",
        headers: { cookie },
      });
      expect(badStatus.statusCode).toBe(422);

      const badLimit = await app.inject({
        method: "GET",
        url: "/api/tasks?limit=0",
        headers: { cookie },
      });
      expect(badLimit.statusCode).toBe(422);
    });

    it("展示名给飞书机器人名,不是裸 id", async () => {
      await fixture.db.run("UPDATE agent SET feishu_bot_name = ? WHERE id = ?", "小工", "agt_a");
      await createTask("agt_a");
      const cookie = await consoleCookie();

      const response = await app.inject({
        method: "GET",
        url: "/api/tasks",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      const item = response.json().items[0];
      expect(item.assignee_label).toBe("小工");
      // 下发人是「console」这种非 Agent 值,原样透出
      expect(item.assigner_label).toBe("console");
    });

    it("详情一次返回任务、授权摘要与 token 汇总", async () => {
      const taskId = await createTask();
      await seedUsage(taskId);
      const cookie = await consoleCookie();

      const response = await app.inject({
        method: "GET",
        url: `/api/tasks/${taskId}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.task).toMatchObject({ id: taskId, status: "pending" });
      expect(body.tokens).toEqual({ total: 165, entries: 1 });
      expect(body.capabilities).toEqual([
        expect.objectContaining({
          id: "cap_1",
          target: "db.prod",
          action: "read",
          status: "pending",
          scope: { tables: ["orders"] },
        }),
      ]);
      // 不返回 ticket 标识与证书内容
      expect(body.capabilities[0]).not.toHaveProperty("ticket_id");
      expect(body.revision).toBeGreaterThan(0);
    });

    it("时间线支持快照与 seq 增量", async () => {
      const taskId = await createTask();
      const cookie = await consoleCookie();

      const snapshot = await app.inject({
        method: "GET",
        url: `/api/tasks/${taskId}/events`,
        headers: { cookie },
      });
      expect(snapshot.statusCode).toBe(200);
      expect(snapshot.json().items).toEqual([
        expect.objectContaining({ seq: 1, kind: "created" }),
      ]);
      expect(snapshot.json().nextCursor).toBeNull();

      await app.inject({
        method: "PATCH",
        url: `/api/tasks/${taskId}`,
        headers: headers("agt_a"),
        payload: { status: "running" },
      });

      const delta = await app.inject({
        method: "GET",
        url: `/api/tasks/${taskId}/events?cursor=1`,
        headers: { cookie },
      });
      expect(delta.json().items).toEqual([
        expect.objectContaining({ seq: 2, kind: "resumed" }),
      ]);
      expect(delta.json().nextCursor).toBeNull();

      const badCursor = await app.inject({
        method: "GET",
        url: `/api/tasks/${taskId}/events?cursor=abc`,
        headers: { cookie },
      });
      expect(badCursor.statusCode).toBe(422);
    });

    it("不存在任务返回 404", async () => {
      const cookie = await consoleCookie();
      for (const url of ["/api/tasks/tsk_404", "/api/tasks/tsk_404/events"]) {
        const response = await app.inject({ method: "GET", url, headers: { cookie } });
        expect(response.statusCode).toBe(404);
      }
    });
  });
});
