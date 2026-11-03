import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { insertCapability } from "../../store/repositories/capability.js";
import { insertTask } from "../../store/repositories/task.js";
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
  for (const [taskId, assignee] of [
    ["tsk_a", agentA.agent.id],
    ["tsk_b", agentB.agent.id],
  ] as const) {
    insertTask(db, {
      id: taskId,
      title: taskId,
      assigner: "console",
      assignee,
      project: "aw",
      parentTaskId: null,
      origin: "a2a",
      deadlineAt: null,
      output: null,
      createdAt: 1,
    });
  }
  insertCapability(db, {
    id: "cap_a",
    subject: agentA.agent.id,
    target: "db.read",
    action: "read",
    scopeJson: "{}",
    ttlSeconds: 900,
    taskId: "tsk_a",
    createdAt: 1,
  });
  insertCapability(db, {
    id: "cap_b",
    subject: agentB.agent.id,
    target: "db.read",
    action: "read",
    scopeJson: "{}",
    ttlSeconds: 900,
    taskId: "tsk_b",
    createdAt: 1,
  });
  return {
    db,
    secrets: {
      [agentA.agent.id]: agentA.secret,
      [agentB.agent.id]: agentB.secret,
    },
  };
}

function auditPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "run_1",
    taskId: "tsk_a",
    tool: "task.create",
    argsHash: "a".repeat(64),
    level: "L1",
    verdict: "allow",
    reason: null,
    capabilityId: null,
    durationMs: null,
    occurredAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("POST /api/audit/tool-calls", () => {
  let fixture: Fixture;
  let app: FastifyInstance;

  function headers(agentId = "agt_a"): Record<string, string> {
    return {
      authorization: `Bearer ${agentId}.${fixture.secrets[agentId] ?? ""}`,
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

  it("Bearer 上报后写入审计,agent_id 取自身份而非负载", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/audit/tool-calls",
      headers: headers(),
      payload: auditPayload({ agentId: "agt_b" }),
    });

    expect(response.statusCode).toBe(201);
    const row = await fixture.db.get("SELECT run_id AS runId, agent_id AS agentId, task_id AS taskId, tool FROM tool_call_log");
    expect(row).toEqual({
      runId: "run_1",
      agentId: "agt_a",
      taskId: "tsk_a",
      tool: "task.create",
    });
  });

  it("无 Bearer 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/audit/tool-calls",
      headers: { "content-type": "application/json" },
      payload: auditPayload(),
    });
    expect(response.statusCode).toBe(401);
  });

  it("非法负载 422", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/audit/tool-calls",
      headers: headers(),
      payload: auditPayload({ argsHash: "not-a-hash" }),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.detail).toEqual([
      expect.objectContaining({ path: "argsHash" }),
    ]);
  });

  it("不能给别人的任务或授权写审计", async () => {
    const foreignTask = await app.inject({
      method: "POST",
      url: "/api/audit/tool-calls",
      headers: headers("agt_a"),
      payload: auditPayload({ taskId: "tsk_b" }),
    });
    expect(foreignTask.statusCode).toBe(403);

    const missingTask = await app.inject({
      method: "POST",
      url: "/api/audit/tool-calls",
      headers: headers("agt_a"),
      payload: auditPayload({ taskId: "tsk_404" }),
    });
    expect(missingTask.statusCode).toBe(404);

    const foreignCapability = await app.inject({
      method: "POST",
      url: "/api/audit/tool-calls",
      headers: headers("agt_a"),
      payload: auditPayload({ capabilityId: "cap_b" }),
    });
    expect(foreignCapability.statusCode).toBe(403);
  });

  it("授权属于同一任务时正常落库", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/audit/tool-calls",
      headers: headers(),
      payload: auditPayload({ tool: "db.read", level: "L2", capabilityId: "cap_a" }),
    });
    expect(response.statusCode).toBe(201);
    const row = await fixture.db.get("SELECT capability_id AS capabilityId, verdict FROM tool_call_log");
    expect(row).toEqual({ capabilityId: "cap_a", verdict: "allow" });
  });
});
