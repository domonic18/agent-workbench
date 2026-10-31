import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { hasIngestReceipt } from "../../store/repositories/ingest-receipt.js";
import { findRunningRunForStream, listTimelineEventsByRun } from "../../store/repositories/run.js";
import { buildApp } from "../app.js";

interface Fixture {
  db: Db;
  secret: string;
  agentId: string;
}

function prepare(): Fixture {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const identity = createIdentityService({ db, newSecret: () => "secret-m1" });
  const machine = identity.registerMachine({
    id: "m1",
    hostname: "h",
    os: "linux",
    collectorVersion: "1",
  });
  const agent = identity.registerAgent({ machineId: "m1", project: "pa", displayName: "A" });
  return { db, secret: machine.secret, agentId: agent.agent.id };
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    collector_id: "m1",
    agent_project: "pa",
    stream_id: "claude-session:s1",
    batch: [
      { seq: 1, kind: "turn", occurred_at: 1_001, payload: { ord: 1 } },
      { seq: 2, kind: "turn", occurred_at: 1_002, payload: { ord: 2 } },
    ],
    sent_at: 1_003,
    ...overrides,
  };
}

describe("ingest 路由", () => {
  let fixture: Fixture;
  let app: FastifyInstance;

  function headers(): Record<string, string> {
    return {
      authorization: `Bearer m1.${fixture.secret}`,
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

  it("采集器 Bearer 推送成功,返回已确认 seq", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: headers(),
      payload: body(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ acked_seq: 2 });
    const run = findRunningRunForStream(fixture.db, fixture.agentId, "claude-session:s1")!;
    expect(listTimelineEventsByRun(fixture.db, run.id)).toHaveLength(2);
  });

  it("无 Bearer 或密钥错误 401", async () => {
    const missing = await app.inject({ method: "POST", url: "/api/ingest", payload: body() });
    expect(missing.statusCode).toBe(401);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: { authorization: "Bearer m1.bad", "content-type": "application/json" },
      payload: body(),
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("collector_id 与身份不符 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: headers(),
      payload: body({ collector_id: "m2" }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("BAD_REQUEST");
  });

  it("未登记的 agent_project 整批 400,不落回执", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: headers(),
      payload: body({ agent_project: "nope" }),
    });
    expect(response.statusCode).toBe(400);
    expect(
      hasIngestReceipt(fixture.db, {
        collectorId: "m1",
        streamId: "claude-session:s1",
        seq: 1,
      }),
    ).toBe(false);
  });

  it("空批次与乱序 seq 被 400 拒绝并带字段路径", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: headers(),
      payload: body({ batch: [] }),
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.detail).toEqual([expect.objectContaining({ path: "batch" })]);

    const unordered = await app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: headers(),
      payload: body({
        batch: [
          { seq: 2, kind: "turn", occurred_at: 1_002, payload: {} },
          { seq: 1, kind: "turn", occurred_at: 1_001, payload: {} },
        ],
      }),
    });
    expect(unordered.statusCode).toBe(400);
    expect(unordered.json().error.detail).toEqual([
      expect.objectContaining({ path: "batch.1.seq" }),
    ]);
  });

  it("部分成功返回 200 与已提交的最大 seq", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: headers(),
      payload: body({
        batch: [
          { seq: 1, kind: "turn", occurred_at: 1_001, payload: { ord: 1 } },
          { seq: 2, kind: "token_usage", occurred_at: 1_002, payload: { ord: 2 } },
          { seq: 3, kind: "turn", occurred_at: 1_003, payload: { ord: 3 } },
        ],
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ acked_seq: 1 });
    expect(
      hasIngestReceipt(fixture.db, {
        collectorId: "m1",
        streamId: "claude-session:s1",
        seq: 3,
      }),
    ).toBe(false);
  });
});
