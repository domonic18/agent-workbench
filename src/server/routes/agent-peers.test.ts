import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

interface Fixture {
  db: Db;
  app: FastifyInstance;
  /** 发送方 Agent 的 Bearer 凭据 */
  token: string;
  /** 发送方 Agent id */
  agentId: string;
  /** 白名单里的目标 Agent id */
  peerId: string;
}

async function prepare(): Promise<Fixture> {
  const db = await openDatabase();
  await ensureConsoleCredential(db, "secret1234567");
  const identity = createIdentityService({
    db,
    newAgentId: (() => {
      let n = 0;
      return () => `agt_p${(n += 1)}`;
    })(),
    newSecret: (() => {
      let n = 0;
      return () => `secret-p${(n += 1)}`;
    })(),
  });
  await identity.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
  const sender = await identity.registerAgent({
    machineId: "m1",
    project: "pa",
    displayName: "发送方",
  });
  const peer = await identity.registerAgent({
    machineId: "m1",
    project: "pb",
    displayName: "接收方",
  });
  await identity.setAllowedTargets(sender.agent.id, [peer.agent.id]);

  const app = buildApp({ db, logLevel: "silent" });
  await app.ready();
  return {
    db,
    app,
    token: `${sender.agent.id}.${sender.secret}`,
    agentId: sender.agent.id,
    peerId: peer.agent.id,
  };
}

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.app.close();
  await fixture?.db.close();
  fixture = undefined;
});

describe("Agent 可委派目标查询", () => {
  it("无凭据 401", async () => {
    fixture = await prepare();
    const response = await fixture.app.inject({ method: "GET", url: "/api/agent/peers" });
    expect(response.statusCode).toBe(401);
  });

  it("返回自己的身份与白名单里的目标", async () => {
    fixture = await prepare();
    const response = await fixture.app.inject({
      method: "GET",
      url: "/api/agent/peers",
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      self: { id: string; displayName: string; project: string };
      peers: { id: string; displayName: string }[];
    };
    expect(body.self.id).toBe(fixture.agentId);
    expect(body.self.displayName).toBe("发送方");
    expect(body.peers.map((peer) => peer.id)).toEqual([fixture.peerId]);
    expect(body.peers[0]?.displayName).toBe("接收方");
  });

  it("白名单为空时返回空列表", async () => {
    fixture = await prepare();
    const identity = createIdentityService({ db: fixture.db });
    await identity.setAllowedTargets(fixture.agentId, []);
    const response = await fixture.app.inject({
      method: "GET",
      url: "/api/agent/peers",
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { peers: unknown[] }).peers).toEqual([]);
  });
});
