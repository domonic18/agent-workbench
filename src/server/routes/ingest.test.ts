import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { hasIngestReceipt } from "../../store/repositories/ingest-receipt.js";
import { findMachineById } from "../../store/repositories/machine.js";
import { findRunningRunForStream, listTimelineEventsByRun } from "../../store/repositories/run.js";
import { ensureConsoleCredential } from "../credential.js";
import { buildApp } from "../app.js";

interface Fixture {
  db: Db;
  secret: string;
  agentId: string;
}

async function prepare(): Promise<Fixture> {
  const db = await openDatabase();
  await ensureConsoleCredential(db, "simple-123");
  const identity = createIdentityService({ db, newSecret: () => "secret-m1" });
  const machine = await identity.registerMachine({
    id: "m1",
    hostname: "h",
    os: "linux",
    collectorVersion: "1",
  });
  const agent = await identity.registerAgent({ machineId: "m1", project: "pa", displayName: "A" });
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

  beforeEach(async () => {
    fixture = await prepare();
    app = buildApp({ logLevel: "silent", db: fixture.db });
  });

  afterEach(async () => {
    await app.close();
    await fixture.db.close();
  });

  it("采集器 Bearer 推送成功,返回已确认 seq", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: headers(),
      payload: body(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ acked_seq: 2, rejected: 0 });
    const run = (await findRunningRunForStream(fixture.db, fixture.agentId, "claude-session:s1"))!;
    expect(await listTimelineEventsByRun(fixture.db, run.id)).toHaveLength(2);
  });

  it("超大 seq(>int4)成功落库——会话日志超 ~21.5MB 后偏移编码不越界", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: headers(),
      payload: body({
        batch: [{ seq: 2_148_526_901, kind: "turn", occurred_at: 1_001, payload: { ord: 1 } }],
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ acked_seq: 2_148_526_901, rejected: 0 });
    expect(
      await hasIngestReceipt(fixture.db, {
        collectorId: "m1",
        streamId: "claude-session:s1",
        seq: 2_148_526_901,
      }),
    ).toBe(true);
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
      await hasIngestReceipt(fixture.db, {
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

  it("坏项被跳过时返回 200、越过坏项的 seq 与被拒计数", async () => {
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
    expect(response.json()).toEqual({ acked_seq: 3, rejected: 1 });
    expect(
      await hasIngestReceipt(fixture.db, {
        collectorId: "m1",
        streamId: "claude-session:s1",
        seq: 3,
      }),
    ).toBe(true);
  });

  it("心跳推进机器存活时间并回带已登记项目", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ingest/heartbeat",
      headers: headers(),
      payload: { uptime: 12, pending_bytes: 0, unattributed_streams: 0 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, projects: ["pa"] });
    expect((await findMachineById(fixture.db, "m1"))?.lastSeenAt).toBeTypeOf("number");
  });

  it("心跳与项目列表都要求采集器 Bearer", async () => {
    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/ingest/heartbeat",
      payload: {},
    });
    expect(heartbeat.statusCode).toBe(401);

    const projects = await app.inject({ method: "GET", url: "/api/ingest/projects" });
    expect(projects.statusCode).toBe(401);
  });

  it("项目列表只返回本机已登记项目", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/ingest/projects",
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ projects: ["pa"] });
  });
});
