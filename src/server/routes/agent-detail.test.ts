import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertRun, insertTimelineEvent } from "../../store/repositories/run.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret1234567";

interface TimelineBody {
  items: {
    id: string;
    runId: string;
    runProject: string;
    runMachine: string;
    kind: string;
    occurredAt: number;
    payload: Record<string, unknown>;
  }[];
  nextCursor: string | null;
}

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

describe("Agent 对话流只读接口", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = await openDatabase();
    await ensureConsoleCredential(db, PASSWORD);
    app = buildApp({ logLevel: "silent", db });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookieOf(login);

    await db.run(
      "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
    );
    await db.run(
      `INSERT INTO agent (id, machine_id, runtime, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
       VALUES ('agt_a', 'm1', 'claude_code', 'pa', '机器人A', 'hash', 'active', '[]', 0, 0)`,
    );
    await db.run(
      `INSERT INTO agent (id, machine_id, runtime, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
       VALUES ('agt_wb', NULL, 'workbuddy', 'wb', '机器人W', 'hash', 'active', '[]', 0, 0)`,
    );
    await insertRun(db, {
      id: "run_1",
      agentId: "agt_a",
      machine: "m1",
      project: "pa",
      streamId: "claude-session:s1",
      startedAt: 1_000,
    });
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  async function addEvent(
    id: string,
    kind: string,
    occurredAt: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await insertTimelineEvent(db, {
      id,
      runId: "run_1",
      turnId: "turn_1",
      blockId: "blk_1",
      ord: occurredAt,
      blockRev: 1,
      offset: null,
      kind,
      payload,
      occurredAt,
    });
  }

  it("未登录拒绝,未知 Agent 返回 404", async () => {
    expect((await app.inject({ method: "GET", url: "/api/agents/agt_a/timeline" })).statusCode).toBe(
      401,
    );
    const missing = await app.inject({
      method: "GET",
      url: "/api/agents/agt_missing/timeline",
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("事件按时间正序下发,payload 是解析后的对象", async () => {
    await addEvent("tle_2", "assistant_message", 1_200, { text: "在的", length: 2 });
    await addEvent("tle_1", "user_message", 1_100, { text: "跑一下", length: 3 });

    const response = await app.inject({
      method: "GET",
      url: "/api/agents/agt_a/timeline",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as TimelineBody;
    expect(body.items.map((item) => item.id)).toEqual(["tle_1", "tle_2"]);
    expect(body.items[0]?.payload).toEqual({ text: "跑一下", length: 3 });
    expect(body.items[0]?.runProject).toBe("pa");
    expect(body.items[0]?.runMachine).toBe("m1");
    expect(body.nextCursor).toBeNull();
  });

  it("游标向前翻更早的事件,不重不漏", async () => {
    for (let index = 1; index <= 5; index += 1) {
      await addEvent(`tle_${index}`, "user_message", 1_000 + index, { text: `第${index}条` });
    }

    const first = await app.inject({
      method: "GET",
      url: "/api/agents/agt_a/timeline?limit=2",
      headers: { cookie },
    });
    const firstBody = first.json() as TimelineBody;
    expect(firstBody.items.map((item) => item.id)).toEqual(["tle_4", "tle_5"]);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: "GET",
      url: `/api/agents/agt_a/timeline?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor as string)}`,
      headers: { cookie },
    });
    const secondBody = second.json() as TimelineBody;
    expect(secondBody.items.map((item) => item.id)).toEqual(["tle_2", "tle_3"]);

    const third = await app.inject({
      method: "GET",
      url: `/api/agents/agt_a/timeline?limit=2&cursor=${encodeURIComponent(secondBody.nextCursor as string)}`,
      headers: { cookie },
    });
    const thirdBody = third.json() as TimelineBody;
    expect(thirdBody.items.map((item) => item.id)).toEqual(["tle_1"]);
    expect(thirdBody.nextCursor).toBeNull();
  });

  it("外部运行时的 Agent 没有过程数据,返回空列表", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/agents/agt_wb/timeline",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [], nextCursor: null });
  });

  it("limit 非法时回 422", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/agents/agt_a/timeline?limit=9999",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(422);
  });
});
