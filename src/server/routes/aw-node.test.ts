import { describe, expect, it } from "vitest";
import { issueOneTimeToken } from "../../domain/bootstrap/one-time-token.js";
import { ONE_TIME_TOKEN } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "simple-123";

interface Fixture {
  db: Db;
  app: ReturnType<typeof buildApp>;
}

/** enroll 不依赖初始化状态:裸库(bootstrap mode)也要能兑换 */
async function enrollApp(): Promise<Fixture> {
  const db = await openDatabase();
  const app = buildApp({ db, logLevel: "silent" });
  await app.ready();
  return { db, app };
}

async function seedEnrollToken(db: Db, ttlMs = ONE_TIME_TOKEN.enrollTtlMs): Promise<string> {
  const { token } = await issueOneTimeToken(db, { purpose: "enroll", ttlMs });
  return token;
}

function enrollPayload(token: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { token, hostname: "mac-test", os: "darwin", collector_version: "0.1.0", ...overrides };
}

describe("POST /api/aw-node/enroll", () => {
  it("bootstrap mode 下可兑换:落机器与密钥哈希,明文只在响应出现一次", async () => {
    const fixture = await enrollApp();
    await ensureConsoleCredential(fixture.db, PASSWORD); // enroll 与初始化状态无关,两侧都测
    const token = await seedEnrollToken(fixture.db);

    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: enrollPayload(token),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { machine_id: string; collector_secret: string };
    expect(body.machine_id).toMatch(/^m-[0-9a-f]{12}$/);
    expect(body.collector_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = (await fixture.db.get(
      'SELECT hostname, os, status, collector_secret_hash AS "secretHash" FROM machine WHERE id = ?',
      body.machine_id,
    )) as { hostname: string; os: string; status: string; secretHash: string };
    expect(row).toMatchObject({ hostname: "mac-test", os: "darwin", status: "active" });
    expect(row.secretHash.startsWith("scrypt$")).toBe(true);
    expect(row.secretHash).not.toContain(body.collector_secret);
    await fixture.db.close();
    await fixture.app.close();
  });

  it("bootstrap mode 未初始化时同样可兑换(令牌即凭据)", async () => {
    const fixture = await enrollApp();
    const token = await seedEnrollToken(fixture.db);
    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: enrollPayload(token),
    });
    expect(response.statusCode).toBe(201);
    await fixture.db.close();
    await fixture.app.close();
  });

  it("重放 410、错误令牌 401、响应不回显令牌", async () => {
    const fixture = await enrollApp();
    const token = await seedEnrollToken(fixture.db);
    await fixture.app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: enrollPayload(token),
    });
    const replay = await fixture.app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: enrollPayload(token),
    });
    expect(replay.statusCode).toBe(410);
    expect(replay.body).not.toContain(token);

    const wrong = await fixture.app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: enrollPayload("ott_wrong-token"),
    });
    expect(wrong.statusCode).toBe(401);

    // 重放不产生第二台机器
    expect(await fixture.db.get("SELECT COUNT(*)::int AS n FROM machine")).toEqual({ n: 1 });
    await fixture.db.close();
    await fixture.app.close();
  });

  it("同一台机重新 enroll 复用机器行,不新增行", async () => {
    const fixture = await enrollApp();
    const first = await fixture.app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: enrollPayload(await seedEnrollToken(fixture.db)),
    });
    const second = await fixture.app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: enrollPayload(await seedEnrollToken(fixture.db)),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().machine_id).toBe(first.json().machine_id);
    expect(second.json().collector_secret).not.toBe(first.json().collector_secret);
    expect(await fixture.db.get("SELECT COUNT(*)::int AS n FROM machine")).toEqual({ n: 1 });
    await fixture.db.close();
    await fixture.app.close();
  });

  it("过期令牌 410,且不消费不落机", async () => {
    const fixture = await enrollApp();
    const start = 1_000_000;
    const token = await issueOneTimeToken(fixture.db, {
      purpose: "enroll",
      ttlMs: 1_000,
      now: () => start,
    }).then((issued) => issued.token);

    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: enrollPayload(token),
    });
    expect(response.statusCode).toBe(410);
    expect(await fixture.db.get("SELECT COUNT(*)::int AS n FROM machine")).toEqual({ n: 0 });
    await fixture.db.close();
    await fixture.app.close();
  });

  it("bootstrap_admin 令牌不能用于 enroll(用途隔离)", async () => {
    const fixture = await enrollApp();
    const { token } = await issueOneTimeToken(fixture.db, {
      purpose: "bootstrap_admin",
      ttlMs: ONE_TIME_TOKEN.adminTtlMs,
    });
    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: enrollPayload(token),
    });
    expect(response.statusCode).toBe(401);
    await fixture.db.close();
    await fixture.app.close();
  });

  it("缺 token 或主机元数据 422,不消费令牌", async () => {
    const fixture = await enrollApp();
    const token = await seedEnrollToken(fixture.db);
    for (const overrides of [{ token: "" }, { hostname: "" }, { os: "" }, { collector_version: "" }]) {
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/aw-node/enroll",
        payload: enrollPayload(token, overrides),
      });
      expect(response.statusCode).toBe(422);
    }
    // 422 不消费:补全后仍可兑换
    const ok = await fixture.app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: enrollPayload(token),
    });
    expect(ok.statusCode).toBe(201);
    await fixture.db.close();
    await fixture.app.close();
  });
});
