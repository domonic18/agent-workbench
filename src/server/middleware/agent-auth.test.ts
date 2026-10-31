import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { parseAgentBearer, requireAgentAuth } from "./agent-auth.js";

let db: Db;
let app: FastifyInstance;
let agentId: string;
let secret: string;

function prepare(): Db {
  const opened = openDatabase(":memory:");
  runMigrations(opened);
  return opened;
}

beforeEach(async () => {
  db = prepare();
  const service = createIdentityService({
    db,
    newAgentId: () => "agt_a",
    newSecret: () => "secret-a",
  });
  service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
  const registered = service.registerAgent({
    machineId: "m1",
    project: "aw",
    displayName: "Agent A",
    allowedTargets: ["agt_b"],
  });
  agentId = registered.agent.id;
  secret = registered.secret;

  app = Fastify();
  app.get("/who", { preHandler: requireAgentAuth(db) }, async (request) => ({
    id: request.agent?.id ?? null,
  }));
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("parseAgentBearer", () => {
  it("解析 Bearer <id>.<secret>,按第一个点切分", () => {
    expect(parseAgentBearer("Bearer agt_a.secret.with.dot")).toEqual({
      agentId: "agt_a",
      secret: "secret.with.dot",
    });
    expect(parseAgentBearer("bearer  agt_a.secret")).toEqual({ agentId: "agt_a", secret: "secret" });
  });

  it("缺失 / 缺分隔符 / 空段一律 undefined", () => {
    expect(parseAgentBearer(undefined)).toBeUndefined();
    expect(parseAgentBearer("Basic abc")).toBeUndefined();
    expect(parseAgentBearer("Bearer agt_a")).toBeUndefined();
    expect(parseAgentBearer("Bearer .secret")).toBeUndefined();
    expect(parseAgentBearer("Bearer agt_a.")).toBeUndefined();
  });
});

describe("requireAgentAuth", () => {
  it("通过鉴权并挂上 request.agent", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/who",
      headers: { authorization: `Bearer ${agentId}.${secret}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: agentId });
  });

  it("缺失 / 格式错 / 未知 / 不匹配 / 停用统一 401", async () => {
    const cases: (string | undefined)[] = [
      undefined,
      "Basic abc",
      `Bearer agt_missing.${secret}`,
      `Bearer ${agentId}.wrong`,
      "Bearer no-dot",
    ];
    for (const authorization of cases) {
      const response = await app.inject({
        method: "GET",
        url: "/who",
        ...(authorization === undefined ? {} : { headers: { authorization } }),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "Agent 鉴权失败" },
      });
    }

    db.prepare("UPDATE agent SET status = 'disabled' WHERE id = ?").run(agentId);
    const disabled = await app.inject({
      method: "GET",
      url: "/who",
      headers: { authorization: `Bearer ${agentId}.${secret}` },
    });
    expect(disabled.statusCode).toBe(401);
  });
});
