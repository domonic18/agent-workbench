import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { findAgentById } from "../../store/repositories/identity.js";
import { buildApp } from "../app.js";

interface Fixture {
  db: Db;
  agentId: string;
  secret: string;
}

async function prepare(): Promise<Fixture> {
  const db = await openDatabase();
  const identity = createIdentityService({
    db,
    newAgentId: () => "agt_a",
    newSecret: () => "secret-a",
  });
  await identity.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
  const { agent, secret } = await identity.registerAgent({
    machineId: "m1",
    project: "aw",
    displayName: "Agent A",
  });
  return { db, agentId: agent.id, secret };
}

describe("PUT /api/agents/self/feishu-bot", () => {
  let fixture: Fixture;
  let app: FastifyInstance;

  function headers(): Record<string, string> {
    return {
      authorization: `Bearer ${fixture.agentId}.${fixture.secret}`,
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

  it("自报 bot 身份与 app_id 写入库,重复上报覆盖同值", async () => {
    for (let i = 0; i < 2; i += 1) {
      const response = await app.inject({
        method: "PUT",
        url: "/api/agents/self/feishu-bot",
        headers: headers(),
        payload: { open_id: "ou_bot_a", name: "Agent A Bot", app_id: "cli_a" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    }

    expect(await findAgentById(fixture.db, "agt_a")).toMatchObject({
      feishuBotOpenId: "ou_bot_a",
      feishuBotName: "Agent A Bot",
      feishuAppId: "cli_a",
    });
  });

  it("未上报 app_id 时保留原值", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/agents/self/feishu-bot",
      headers: headers(),
      payload: { open_id: "ou_bot_a", name: "Agent A Bot", app_id: "cli_a" },
    });
    const response = await app.inject({
      method: "PUT",
      url: "/api/agents/self/feishu-bot",
      headers: headers(),
      payload: { open_id: "ou_bot_b", name: "Agent A Bot 2" },
    });
    expect(response.statusCode).toBe(200);
    expect(await findAgentById(fixture.db, "agt_a")).toMatchObject({
      feishuBotOpenId: "ou_bot_b",
      feishuBotName: "Agent A Bot 2",
      feishuAppId: "cli_a",
    });
  });

  it("无 Bearer 401", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/agents/self/feishu-bot",
      headers: { "content-type": "application/json" },
      payload: { open_id: "ou_bot_a", name: "Agent A Bot" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("字段缺失或空白 422", async () => {
    for (const payload of [{ open_id: "ou_bot_a" }, { open_id: " ", name: "Bot" }]) {
      const response = await app.inject({
        method: "PUT",
        url: "/api/agents/self/feishu-bot",
        headers: headers(),
        payload,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    }
  });
});
