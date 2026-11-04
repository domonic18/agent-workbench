import { describe, expect, it } from "vitest";
import { issueOneTimeToken } from "../../domain/bootstrap/one-time-token.js";
import { createIdentityService } from "../../domain/identity/service.js";
import { ONE_TIME_TOKEN } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential, hasConsoleCredential } from "../credential.js";

const PASSWORD = "simple-123";

interface Fixture {
  db: Db;
  app: ReturnType<typeof buildApp>;
}

/** 未种子凭据的 app:bootstrap mode 生效 */
async function bareApp(): Promise<Fixture> {
  const db = await openDatabase();
  const app = buildApp({ db, logLevel: "silent" });
  await app.ready();
  return { db, app };
}

/** 种子凭据的 app:常规登录态 */
async function seededApp(): Promise<Fixture> {
  const db = await openDatabase();
  await ensureConsoleCredential(db, PASSWORD);
  const app = buildApp({ db, logLevel: "silent" });
  await app.ready();
  return { db, app };
}

async function loginCookie(fixture: Fixture): Promise<string> {
  const response = await fixture.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  return sessionCookieOf(response);
}

/** inject 的 set-cookie 可能是字符串或数组,统一取第一个 cookie 的键值对 */
function sessionCookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === "string" ? first.split(";")[0] ?? "" : "";
}

describe("bootstrap mode 门控", () => {
  it("无凭据时业务 API 一律 403 BOOTSTRAP_REQUIRED,/healthz 放行", async () => {
    const fixture = await bareApp();
    const blocked = await fixture.app.inject({ method: "GET", url: "/api/overview" });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("BOOTSTRAP_REQUIRED");

    expect((await fixture.app.inject({ method: "POST", url: "/api/auth/login" })).statusCode).toBe(403);
    expect((await fixture.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    // 非 /api 路径(静态/SPA)不拦:走 404 而非 403
    expect((await fixture.app.inject({ method: "GET", url: "/setup" })).statusCode).toBe(404);
    await fixture.db.close();
    await fixture.app.close();
  });

  it("口令落库后门控立即解除,无需重启", async () => {
    const fixture = await bareApp();
    const { token } = await issueOneTimeToken(fixture.db, {
      purpose: "bootstrap_admin",
      ttlMs: ONE_TIME_TOKEN.adminTtlMs,
    });
    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/bootstrap/admin",
      payload: { token, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(await hasConsoleCredential(fixture.db)).toBe(true);

    const cookie = sessionCookieOf(response);
    const unlocked = await fixture.app.inject({
      method: "GET",
      url: "/api/overview",
      headers: { cookie },
    });
    expect(unlocked.statusCode).toBe(200);
    await fixture.db.close();
    await fixture.app.close();
  });
});

describe("POST /api/bootstrap/admin", () => {
  it("正确 token 设置口令并创建会话", async () => {
    const fixture = await bareApp();
    const { token } = await issueOneTimeToken(fixture.db, {
      purpose: "bootstrap_admin",
      ttlMs: ONE_TIME_TOKEN.adminTtlMs,
    });
    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/bootstrap/admin",
      payload: { token, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(sessionCookieOf(response)).toContain("aw_session=");
    await fixture.db.close();
    await fixture.app.close();
  });

  it("token 重放 410,错误 token 401,响应不回显 token", async () => {
    const fixture = await bareApp();
    const { token } = await issueOneTimeToken(fixture.db, {
      purpose: "bootstrap_admin",
      ttlMs: ONE_TIME_TOKEN.adminTtlMs,
    });
    await fixture.app.inject({
      method: "POST",
      url: "/api/bootstrap/admin",
      payload: { token, password: PASSWORD },
    });
    const replay = await fixture.app.inject({
      method: "POST",
      url: "/api/bootstrap/admin",
      payload: { token, password: PASSWORD },
    });
    expect(replay.statusCode).toBe(410);
    expect(replay.body).not.toContain(token);

    const wrong = await fixture.app.inject({
      method: "POST",
      url: "/api/bootstrap/admin",
      payload: { token: "ott_not-a-real-token", password: PASSWORD },
    });
    expect(wrong.statusCode).toBe(401);
    await fixture.db.close();
    await fixture.app.close();
  });

  it("字段缺失或口令过短 422,不消费 token", async () => {
    const fixture = await bareApp();
    const { token } = await issueOneTimeToken(fixture.db, {
      purpose: "bootstrap_admin",
      ttlMs: ONE_TIME_TOKEN.adminTtlMs,
    });
    expect(
      (await fixture.app.inject({ method: "POST", url: "/api/bootstrap/admin", payload: {} }))
        .statusCode,
    ).toBe(422);
    const short = await fixture.app.inject({
      method: "POST",
      url: "/api/bootstrap/admin",
      payload: { token, password: "123" },
    });
    expect(short.statusCode).toBe(422);
    // 422 不消费:同 token 仍可完成初始化
    const retry = await fixture.app.inject({
      method: "POST",
      url: "/api/bootstrap/admin",
      payload: { token, password: PASSWORD },
    });
    expect(retry.statusCode).toBe(200);
    await fixture.db.close();
    await fixture.app.close();
  });

  it("已有管理员后 409,不再接受 bootstrap token", async () => {
    const fixture = await seededApp();
    const { token } = await issueOneTimeToken(fixture.db, {
      purpose: "bootstrap_admin",
      ttlMs: ONE_TIME_TOKEN.adminTtlMs,
    });
    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/bootstrap/admin",
      payload: { token, password: "another-456" },
    });
    expect(response.statusCode).toBe(409);
    await fixture.db.close();
    await fixture.app.close();
  });
});

describe("GET /api/bootstrap/status", () => {
  it("初始化前须携带可用 bootstrap token(只读不消费)", async () => {
    const fixture = await bareApp();
    expect(
      (await fixture.app.inject({ method: "GET", url: "/api/bootstrap/status" })).statusCode,
    ).toBe(401);

    const { token } = await issueOneTimeToken(fixture.db, {
      purpose: "bootstrap_admin",
      ttlMs: ONE_TIME_TOKEN.adminTtlMs,
    });
    const ok = await fixture.app.inject({
      method: "GET",
      url: "/api/bootstrap/status",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().phase).toBe("awaiting_admin");

    // 轮询不消费:同 token 仍能设置管理员
    const admin = await fixture.app.inject({
      method: "POST",
      url: "/api/bootstrap/admin",
      payload: { token, password: PASSWORD },
    });
    expect(admin.statusCode).toBe(200);
    await fixture.db.close();
    await fixture.app.close();
  });

  it("初始化后走会话,phase 随机器/Agent 计数推进", async () => {
    const fixture = await seededApp();
    const cookie = await loginCookie(fixture);
    const identity = createIdentityService({ db: fixture.db });

    const empty = await fixture.app.inject({
      method: "GET",
      url: "/api/bootstrap/status",
      headers: { cookie },
    });
    expect(empty.json().phase).toBe("awaiting_machine");

    expect(
      (await fixture.app.inject({ method: "GET", url: "/api/bootstrap/status" })).statusCode,
    ).toBe(401);

    await identity.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    const withMachine = await fixture.app.inject({
      method: "GET",
      url: "/api/bootstrap/status",
      headers: { cookie },
    });
    expect(withMachine.json().phase).toBe("awaiting_agents");

    await identity.registerAgent({ machineId: "m1", project: "p", displayName: "A" });
    const ready = await fixture.app.inject({
      method: "GET",
      url: "/api/bootstrap/status",
      headers: { cookie },
    });
    expect(ready.json().phase).toBe("ready");
    await fixture.db.close();
    await fixture.app.close();
  });
});

describe("POST /api/bootstrap/enroll-token", () => {
  it("须会话 + CSRF + 幂等键;签发返回一次性 token", async () => {
    const fixture = await seededApp();
    const cookie = await loginCookie(fixture);

    expect(
      (await fixture.app.inject({ method: "POST", url: "/api/bootstrap/enroll-token" }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await fixture.app.inject({
          method: "POST",
          url: "/api/bootstrap/enroll-token",
          headers: { cookie, "idempotency-key": "k1" },
        })
      ).statusCode,
    ).toBe(403);

    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/bootstrap/enroll-token",
      headers: {
        cookie,
        "idempotency-key": "k2",
        "x-requested-with": "XMLHttpRequest",
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { token: string; expiresAt: number };
    expect(body.token).toMatch(/^ott_/);
    // 库中只存哈希
    const row = (await fixture.db.get(
      "SELECT token_hash AS h, purpose FROM one_time_token",
    )) as { h: string; purpose: string };
    expect(row.purpose).toBe("enroll");
    expect(row.h).not.toContain(body.token);
    await fixture.db.close();
    await fixture.app.close();
  });
});
