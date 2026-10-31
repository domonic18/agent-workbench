import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { buildApp } from "../app.js";

interface Fixture {
  db: Db;
  secrets: Record<string, string>;
}

function prepare(): Fixture {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const ids = ["agt_a", "agt_b"];
  const secrets = ["secret-a", "secret-b"];
  let idSeq = 0;
  let secretSeq = 0;
  const identity = createIdentityService({
    db,
    newAgentId: () => ids[idSeq++] ?? "agt_x",
    newSecret: () => secrets[secretSeq++] ?? "secret-x",
  });
  identity.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
  const agentA = identity.registerAgent({ machineId: "m1", project: "pa", displayName: "A" });
  const agentB = identity.registerAgent({ machineId: "m1", project: "pb", displayName: "B" });
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

  beforeEach(() => {
    fixture = prepare();
    app = buildApp({ logLevel: "silent", db: fixture.db });
  });

  afterEach(async () => {
    await app.close();
    fixture.db.close();
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
});
