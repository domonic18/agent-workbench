import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createA2aService } from "../../domain/a2a/service.js";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";

interface Fixture {
  db: Db;
  app: FastifyInstance;
  token: string;
}

async function prepare(): Promise<Fixture> {
  const db = await openDatabase();
  const identity = createIdentityService({ db, newAgentId: () => "agt_a", newSecret: () => "secret-a" });
  await identity.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
  const { agent, secret } = await identity.registerAgent({
    machineId: "m1",
    project: "pa",
    displayName: "Agent A",
  });

  const app = buildApp({
    db,
    knowledgeDir: mkdtempSync(join(tmpdir(), "aw-kb-")),
    a2a: createA2aService({ db, waitMs: 0 }),
    logLevel: "silent",
  });
  await app.ready();
  return { db, app, token: `${agent.id}.${secret}` };
}

function rpc(id: number, method: string, params?: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

// Streamable HTTP 规范要求客户端声明两种响应形态,缺 Accept 会被 SDK 以 406 拒绝
const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function callResult(body: Record<string, unknown>): Record<string, unknown> {
  return body.result as Record<string, unknown>;
}

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.app.close();
  await fixture?.db.close();
  fixture = undefined;
});

describe("远程 MCP /mcp 路由", () => {
  it("无鉴权 401", async () => {
    fixture = await prepare();
    const response = await fixture.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json" },
      payload: rpc(1, "tools/list"),
    });
    expect(response.statusCode).toBe(401);
  });

  it("tools/list 返回 13 个裸名控制工具", async () => {
    fixture = await prepare();
    const response = await fixture.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...MCP_HEADERS, authorization: `Bearer ${fixture.token}` },
      payload: rpc(1, "tools/list"),
    });

    expect(response.statusCode).toBe(200);
    const tools = (callResult(response.json()) as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "task_create",
      "task_update",
      "a2a_send",
      "a2a_inbox",
      "a2a_ack",
      "kb_search",
      "kb_write",
      "work_inbox",
      "work_read",
      "work_ack",
      "work_handback",
      "work_report",
      "work_decide",
    ]);
  });

  it("tools/call task_create 建单并落审计,run_id 为 null", async () => {
    fixture = await prepare();
    const response = await fixture.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...MCP_HEADERS, authorization: `Bearer ${fixture.token}` },
      payload: rpc(1, "tools/call", {
        name: "task_create",
        arguments: { title: "查日志", assigner: "console", project: "aw" },
      }),
    });

    expect(response.statusCode).toBe(200);
    const result = callResult(response.json()) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBeUndefined();
    const task = JSON.parse(result.content[0]?.text ?? "{}") as {
      task: { id: string; assignee: string };
    };
    expect(task.task.assignee).toBe("agt_a");

    const row = (await fixture.db.get(
      'SELECT run_id AS "runId", task_id AS "taskId", tool, verdict FROM tool_call_log',
    )) as { runId: string | null; taskId: string | null; tool: string; verdict: string };
    expect(row).toEqual({ runId: null, taskId: null, tool: "task.create", verdict: "allow" });
  });

  it("GET /mcp 一律 405 且标注 Allow: POST", async () => {
    fixture = await prepare();
    const response = await fixture.app.inject({
      method: "GET",
      url: "/mcp",
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe("POST");
  });
});
