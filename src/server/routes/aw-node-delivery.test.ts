import { describe, expect, it } from "vitest";
import { createIdentityService } from "../../domain/identity/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "simple-123";
const WRITE_HEADERS = { "x-requested-with": "fetch", "idempotency-key": "test-key" };

interface Fixture {
  db: Db;
  app: ReturnType<typeof buildApp>;
  machineId: string;
  machineSecret: string;
  cookie: string;
}

/** 已初始化控制台 + 一台已登记机器(已知 Bearer),模拟 enroll 完成后的状态 */
async function deliveryApp(): Promise<Fixture> {
  const db = await openDatabase();
  await ensureConsoleCredential(db, PASSWORD);
  const service = createIdentityService({ db });
  const { machine, secret } = await service.registerMachine({
    id: "m-deliv-1",
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

async function confirm(
  f: Fixture,
  agents: Array<Record<string, unknown>>,
  machineId = f.machineId,
  key = "confirm-key",
) {
  return f.app.inject({
    method: "POST",
    url: "/api/bootstrap/agents",
    headers: { cookie: f.cookie, ...WRITE_HEADERS, "idempotency-key": key },
    payload: { machineId, agents },
  });
}

describe("POST /api/aw-node/discovery", () => {
  it("机器 Bearer 上报落库,控制台读取预填视图,确认后翻已确认", async () => {
    const f = await deliveryApp();
    const report = {
      projects: [{ name: "proj-a", cwd: "/Users/x/proj-a", agents: [{ model: "opus" }] }],
    };
    const response = await f.app.inject({
      method: "POST",
      url: "/api/aw-node/discovery",
      headers: { ...machineAuth(f), "idempotency-key": "disc-1" },
      payload: report,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });

    const row = (await f.db.get(
      'SELECT discovery_json AS j, discovery_received_at AS "receivedAt" FROM machine WHERE id = ?',
      f.machineId,
    )) as { j: string; receivedAt: number };
    expect(JSON.parse(row.j)).toEqual(report);
    expect(row.receivedAt).toBeGreaterThan(0);

    const view = await f.app.inject({
      method: "GET",
      url: "/api/bootstrap/discovery",
      headers: { cookie: f.cookie },
    });
    expect(view.statusCode).toBe(200);
    const body = view.json() as {
      machines: Array<{
        machineId: string;
        projects: Array<{ name: string; cwd?: string; confirmed: boolean }>;
      }>;
    };
    expect(body.machines).toHaveLength(1);
    expect(body.machines[0]).toMatchObject({ machineId: f.machineId });
    expect(body.machines[0]!.projects[0]).toEqual({
      name: "proj-a",
      cwd: "/Users/x/proj-a",
      confirmed: false,
    });

    // 确认后同一视图翻已确认,/setup 据此预勾选
    expect((await confirm(f, [{ project: "proj-a" }])).statusCode).toBe(201);
    const reView = await f.app.inject({
      method: "GET",
      url: "/api/bootstrap/discovery",
      headers: { cookie: f.cookie },
    });
    const reBody = reView.json() as {
      machines: Array<{ projects: Array<{ name: string; confirmed: boolean }> }>;
    };
    expect(reBody.machines[0]!.projects[0]).toMatchObject({ name: "proj-a", confirmed: true });
    await f.db.close();
    await f.app.close();
  });

  it("反例:无 Bearer / 错密钥 401,缺幂等键 422;空项目列表如实落库", async () => {
    const f = await deliveryApp();
    const report = { projects: [{ name: "proj-a" }] };
    const post = (headers: Record<string, string>) =>
      f.app.inject({ method: "POST", url: "/api/aw-node/discovery", headers, payload: report });

    expect((await post({ "idempotency-key": "k" })).statusCode).toBe(401);
    expect(
      (
        await post({
          authorization: `Bearer ${f.machineId}.wrong-secret`,
          "idempotency-key": "k",
        })
      ).statusCode,
    ).toBe(401);
    expect((await post(machineAuth(f))).statusCode).toBe(422);
    // 执行机没装 cc-connect:如实上报空扫描,控制台据此区分「未上报」与「上报为空」
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/aw-node/discovery",
          headers: { ...machineAuth(f), "idempotency-key": "k" },
          payload: { projects: [] },
        })
      ).statusCode,
    ).toBe(200);
    await f.db.close();
    await f.app.close();
  });
});

describe("POST /api/bootstrap/agents 反例", () => {
  it("未知机器 404,同机重复项目 409,key 冲突 409,非法 key 与不可推导项目名 422,无会话 401", async () => {
    const f = await deliveryApp();

    const unknown = await f.app.inject({
      method: "POST",
      url: "/api/bootstrap/agents",
      headers: { cookie: f.cookie, ...WRITE_HEADERS },
      payload: { machineId: "m-missing", agents: [{ project: "p" }] },
    });
    expect(unknown.statusCode).toBe(404);

    expect((await confirm(f, [{ project: "proj-a" }], undefined, "c1")).statusCode).toBe(201);
    expect((await confirm(f, [{ project: "proj-a" }], undefined, "c2")).statusCode).toBe(409);

    // 另一台机占用 key "proj-b" 后,本机同名项目的默认 key 推导撞车 → 409
    const service = createIdentityService({ db: f.db });
    await service.registerMachine({ id: "m-two", hostname: "h", os: "linux", collectorVersion: "1" });
    expect((await confirm(f, [{ project: "proj-b" }], "m-two", "c3")).statusCode).toBe(201);
    expect((await confirm(f, [{ project: "proj-b" }], undefined, "c4")).statusCode).toBe(409);

    expect((await confirm(f, [{ project: "proj-d", key: "Bad_Key" }], undefined, "c5")).statusCode).toBe(422);
    expect((await confirm(f, [{ project: "中文项目" }], undefined, "c6")).statusCode).toBe(422);

    const noSession = await f.app.inject({
      method: "POST",
      url: "/api/bootstrap/agents",
      headers: WRITE_HEADERS,
      payload: { machineId: f.machineId, agents: [{ project: "proj-e" }] },
    });
    expect(noSession.statusCode).toBe(401);
    await f.db.close();
    await f.app.close();
  });
});
