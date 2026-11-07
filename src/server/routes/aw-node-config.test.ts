import { describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { verifySecret } from "../../domain/security/secrets.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "simple-123456";
const WRITE_HEADERS = { "x-requested-with": "fetch", "idempotency-key": "test-key" };

interface Fixture {
  db: Db;
  app: ReturnType<typeof buildApp>;
  machineId: string;
  machineSecret: string;
  cookie: string;
}

/** 已初始化控制台 + 一台已登记机器(已知 Bearer),模拟 enroll 完成后的状态 */
async function configApp(): Promise<Fixture> {
  const db = await openDatabase();
  await ensureConsoleCredential(db, PASSWORD);
  const service = createIdentityService({ db });
  const { machine, secret } = await service.registerMachine({
    id: "m-cfg-1",
    hostname: "mac-test",
    os: "darwin",
    collectorVersion: "0.1.0",
  });
  const app = buildApp({ db, logLevel: "silent" });
  await app.ready();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  const raw = login.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return {
    db,
    app,
    machineId: machine.id,
    machineSecret: secret,
    cookie: (typeof first === "string" ? first : "").split(";")[0] ?? "",
  };
}

function machineAuth(f: Fixture): Record<string, string> {
  return { authorization: `Bearer ${f.machineId}.${f.machineSecret}` };
}

async function confirm(f: Fixture, agents: Array<Record<string, unknown>>, key = "confirm-key") {
  return f.app.inject({
    method: "POST",
    url: "/api/bootstrap/agents",
    headers: { cookie: f.cookie, ...WRITE_HEADERS, "idempotency-key": key },
    payload: { machineId: f.machineId, agents },
  });
}

interface DeliveredAgent {
  agent_id: string;
  key: string;
  project: string;
  config_version: number;
  rotated: boolean;
  secret?: string;
  mcp: { endpoint: string };
}

async function pull(f: Fixture): Promise<{ config_status: string; agents: DeliveredAgent[] }> {
  const response = await f.app.inject({
    method: "POST",
    url: "/api/aw-node/config",
    headers: machineAuth(f),
    payload: {},
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { config_status: string; agents: DeliveredAgent[] };
}

async function ack(f: Fixture, acks: Array<Record<string, unknown>>, key = "ack-key") {
  return f.app.inject({
    method: "POST",
    url: "/api/aw-node/config/ack",
    headers: { ...machineAuth(f), "idempotency-key": key },
    payload: { agents: acks },
  });
}

async function machineStatus(f: Fixture): Promise<{ configStatus: string }> {
  return (await f.db.get(
    'SELECT config_status AS "configStatus" FROM machine WHERE id = ?',
    f.machineId,
  )) as { configStatus: string };
}

describe("配置下发链路:/api/bootstrap/agents → /api/aw-node/config → ack", () => {
  it("确认只建身份:无密钥、稳定 key、机器转待下发;未签发密钥不能过 Agent 鉴权", async () => {
    const f = await configApp();
    const response = await confirm(f, [{ project: "proj-a" }]);
    expect(response.statusCode).toBe(201);
    const body = response.json() as { agents: Array<{ id: string; key: string }> };
    expect(body.agents[0]!.key).toBe("proj-a");
    expect(body.agents[0]!.id).toMatch(/^agt_[0-9a-f]{16}$/);
    expect(JSON.stringify(body)).not.toContain("secret");

    const agent = (await f.db.get(
      'SELECT secret_hash AS "secretHash", key, bootstrap_status AS bs, mcp_config_json AS cfg FROM agent WHERE project = ?',
      "proj-a",
    )) as { secretHash: string | null; key: string; bs: string; cfg: string };
    expect(agent.secretHash).toBeNull();
    expect(agent.key).toBe("proj-a");
    expect(agent.bs).toBe("confirmed");
    expect(JSON.parse(agent.cfg)).toMatchObject({ endpoint: "/mcp", key: "proj-a" });
    expect(await machineStatus(f)).toEqual({ configStatus: "pending" });

    expect(
      (
        await f.app.inject({
          method: "GET",
          url: "/api/a2a/inbox",
          headers: { authorization: `Bearer ${body.agents[0]!.id}.any-secret` },
        })
      ).statusCode,
    ).toBe(401);
    await f.db.close();
    await f.app.close();
  });

  it("拉取轮换:明文只在响应出现,库中落哈希,机器 delivered", async () => {
    const f = await configApp();
    await confirm(f, [{ project: "proj-a" }]);

    const delivered = await pull(f);
    expect(delivered.config_status).toBe("delivered");
    const agent = delivered.agents[0]!;
    expect(agent.rotated).toBe(true);
    expect(agent.config_version).toBe(1);
    expect(agent.mcp).toEqual({ endpoint: "/mcp" });
    expect(agent.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = (await f.db.get(
      'SELECT secret_hash AS "secretHash", config_version AS v, config_ack_at AS ack FROM agent WHERE project = ?',
      "proj-a",
    )) as { secretHash: string; v: number; ack: number | null };
    expect(row.secretHash.startsWith("scrypt$")).toBe(true);
    expect(await verifySecret(agent.secret ?? "", row.secretHash)).toBe(true);
    expect(row.v).toBe(1);
    expect(row.ack).toBeNull();
    expect(await machineStatus(f)).toEqual({ configStatus: "delivered" });
    await f.db.close();
    await f.app.close();
  });

  it("响应丢失重试:再次拉取轮换新密钥,旧明文立即失效", async () => {
    const f = await configApp();
    await confirm(f, [{ project: "proj-a" }]);
    const first = await pull(f);
    const second = await pull(f);

    const a = first.agents[0]!;
    const b = second.agents[0]!;
    expect(b.config_version).toBe(2);
    expect(b.secret).not.toBe(a.secret);

    const row = (await f.db.get(
      'SELECT secret_hash AS "secretHash" FROM agent WHERE project = ?',
      "proj-a",
    )) as { secretHash: string };
    expect(await verifySecret(a.secret ?? "", row.secretHash)).toBe(false);
    expect(await verifySecret(b.secret ?? "", row.secretHash)).toBe(true);
    await f.db.close();
    await f.app.close();
  });

  it("ACK 回执版本生效,机器 effective;之后拉取不再有明文", async () => {
    const f = await configApp();
    await confirm(f, [{ project: "proj-a" }]);
    const delivered = await pull(f);
    const agent = delivered.agents[0]!;

    const acked = await ack(f, [{ agent_id: agent.agent_id, config_version: 1 }]);
    expect(acked.statusCode).toBe(200);
    expect(acked.json()).toMatchObject({ ok: true, config_status: "effective" });

    const row = (await f.db.get(
      'SELECT config_ack_at AS ack FROM agent WHERE id = ?',
      agent.agent_id,
    )) as { ack: number | null };
    expect(row.ack).not.toBeNull();

    const after = await pull(f);
    expect(after.config_status).toBe("effective");
    expect(after.agents[0]).toMatchObject({ rotated: false, config_version: 1 });
    expect("secret" in after.agents[0]!).toBe(false);
    expect(await machineStatus(f)).toEqual({ configStatus: "effective" });
    await f.db.close();
    await f.app.close();
  });

  it("ACK 反例:跨机 Agent 403,版本过期 409;重复 ACK 同版本幂等", async () => {
    const f = await configApp();
    await confirm(f, [{ project: "proj-a" }]);
    const delivered = await pull(f);
    const agent = delivered.agents[0]!;

    expect(
      (await ack(f, [{ agent_id: agent.agent_id, config_version: 99 }])).statusCode,
    ).toBe(409);

    // 跨机:第二台机确认的 Agent 不能由本机回执
    const service = createIdentityService({ db: f.db });
    await service.registerMachine({ id: "m-other", hostname: "h2", os: "linux", collectorVersion: "1" });
    const otherConfirm = await f.app.inject({
      method: "POST",
      url: "/api/bootstrap/agents",
      headers: { cookie: f.cookie, ...WRITE_HEADERS, "idempotency-key": "confirm-other" },
      payload: { machineId: "m-other", agents: [{ project: "proj-other" }] },
    });
    expect(otherConfirm.statusCode).toBe(201);
    const otherAgentId = (otherConfirm.json() as { agents: Array<{ id: string }> }).agents[0]!.id;
    expect((await ack(f, [{ agent_id: otherAgentId, config_version: 1 }])).statusCode).toBe(403);

    const first = await ack(f, [{ agent_id: agent.agent_id, config_version: 1 }], "ack-1");
    const retry = await ack(f, [{ agent_id: agent.agent_id, config_version: 1 }], "ack-2");
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    await f.db.close();
    await f.app.close();
  });

  it("未下发(从未拉取)的 confirmed Agent ACK 拒绝 409", async () => {
    const f = await configApp();
    const created = await confirm(f, [{ project: "proj-a" }]);
    const agentId = (created.json() as { agents: Array<{ id: string }> }).agents[0]!.id;

    expect((await ack(f, [{ agent_id: agentId, config_version: 1 }])).statusCode).toBe(409);
    await f.db.close();
    await f.app.close();
  });

  it("已生效机器新增 Agent:回 pending,旧 Agent 不轮换,新 Agent 轮换并 ACK 回 effective", async () => {
    const f = await configApp();
    await confirm(f, [{ project: "proj-a" }]);
    const first = await pull(f);
    await ack(f, [{ agent_id: first.agents[0]!.agent_id, config_version: 1 }]);

    expect((await confirm(f, [{ project: "proj-b" }], "confirm-b")).statusCode).toBe(201);
    expect(await machineStatus(f)).toEqual({ configStatus: "pending" });

    const second = await pull(f);
    expect(second.config_status).toBe("delivered");
    const oldAgent = second.agents.find((a) => a.project === "proj-a")!;
    const newAgent = second.agents.find((a) => a.project === "proj-b")!;
    expect(oldAgent.rotated).toBe(false);
    expect("secret" in oldAgent).toBe(false);
    expect(newAgent.rotated).toBe(true);
    expect(newAgent.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const acked = await ack(f, [
      { agent_id: newAgent.agent_id, config_version: newAgent.config_version },
    ]);
    expect(acked.json()).toMatchObject({ config_status: "effective" });
    await f.db.close();
    await f.app.close();
  });

  it("人工注册的 Agent 不参与下发轮换,注册密钥保持有效", async () => {
    const f = await configApp();
    const service = createIdentityService({ db: f.db });
    const manual = await service.registerAgent({
      machineId: f.machineId,
      project: "proj-manual",
      displayName: "Manual",
    });
    await confirm(f, [{ project: "proj-a" }]);

    const delivered = await pull(f);
    expect(delivered.agents.map((a) => a.project)).toEqual(["proj-a"]);

    const row = (await f.db.get(
      'SELECT secret_hash AS "secretHash" FROM agent WHERE project = ?',
      "proj-manual",
    )) as { secretHash: string };
    expect(await verifySecret(manual.secret, row.secretHash)).toBe(true);
    await f.db.close();
    await f.app.close();
  });
});
