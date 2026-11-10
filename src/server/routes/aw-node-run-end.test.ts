import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { insertRun } from "../../store/repositories/run.js";
import { openDatabase, type Db } from "../../store/database.js";
import { findRunById, findRunningRunForStream } from "../../store/repositories/run.js";
import { ensureConsoleCredential } from "../credential.js";
import { buildApp } from "../app.js";

interface Fixture {
  db: Db;
  secret: string;
  agentId: string;
}

async function prepare(): Promise<Fixture> {
  const db = await openDatabase();
  await ensureConsoleCredential(db, "simple-123456");
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

describe("POST /api/aw-node/run-end", () => {
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

  it("宣告收尾 running run:end_reason=process_exit,重复宣告幂等", async () => {
    await insertRun(fixture.db, {
      id: "run_1",
      agentId: fixture.agentId,
      machine: "m1",
      project: "pa",
      streamId: "claude-session:s1",
      startedAt: 1_000,
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/aw-node/run-end",
      headers: headers(),
      payload: {
        agent_project: "pa",
        stream_id: "claude-session:s1",
        ended_at: 2_000,
        exit_code: 0,
        signal: null,
      },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json() as { run_id: string };
    expect(body.run_id).toBe("run_1");
    expect(await findRunById(fixture.db, "run_1")).toMatchObject({
      status: "ended",
      endedAt: 2_000,
      endReason: "process_exit",
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/aw-node/run-end",
      headers: headers(),
      payload: { agent_project: "pa", stream_id: "claude-session:s1", ended_at: 3_000 },
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { run_id: string | null }).run_id).toBeNull();
    // 幂等重放不改写首次收尾时刻
    expect(await findRunById(fixture.db, "run_1")).toMatchObject({ endedAt: 2_000 });
  });

  it("流上从未有 run 时返回 run_id=null,不建行", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/aw-node/run-end",
      headers: headers(),
      payload: { agent_project: "pa", stream_id: "claude-session:s-missing", ended_at: 2_000 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ run_id: null });
    expect(
      await fixture.db.get("SELECT COUNT(*)::int AS n FROM agent_run"),
    ).toEqual({ n: 0 });
  });

  it("ended_at 早于最后活动时收在最后一次活动,不回拨", async () => {
    await insertRun(fixture.db, {
      id: "run_1",
      agentId: fixture.agentId,
      machine: "m1",
      project: "pa",
      streamId: "claude-session:s1",
      startedAt: 1_000,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/aw-node/run-end",
      headers: headers(),
      payload: { agent_project: "pa", stream_id: "claude-session:s1", ended_at: 500 },
    });
    expect(response.statusCode).toBe(200);
    // startedAt=lastSeenAt=1_000;迟到宣告不得把收尾时刻压到活动之前
    expect(await findRunById(fixture.db, "run_1")).toMatchObject({
      status: "ended",
      endedAt: 1_000,
      endReason: "process_exit",
    });
  });

  it("机器下无该 Agent 项目 404,鉴权失败 401,字段缺失 422", async () => {
    const notFound = await app.inject({
      method: "POST",
      url: "/api/aw-node/run-end",
      headers: headers(),
      payload: { agent_project: "p-missing", stream_id: "claude-session:s1", ended_at: 2_000 },
    });
    expect(notFound.statusCode).toBe(404);

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/aw-node/run-end",
      headers: {
        authorization: "Bearer m1.wrong-secret",
        "content-type": "application/json",
      },
      payload: { agent_project: "pa", stream_id: "claude-session:s1", ended_at: 2_000 },
    });
    expect(unauthorized.statusCode).toBe(401);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/aw-node/run-end",
      headers: headers(),
      payload: { agent_project: "pa" },
    });
    expect(invalid.statusCode).toBe(422);
    expect(
      await findRunningRunForStream(fixture.db, fixture.agentId, "claude-session:s1"),
    ).toBeUndefined();
  });
});
