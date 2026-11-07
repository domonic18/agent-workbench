import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOGIN_LOCKOUT } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

describe("登录失败锁定", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = await openDatabase();
    await ensureConsoleCredential(db, PASSWORD);
    app = buildApp({ logLevel: "silent", db });
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  function login(password: string) {
    return app.inject({ method: "POST", url: "/api/auth/login", payload: { password } });
  }

  it("连续失败达到上限后返回 429,锁定期内正确口令也不放行", async () => {
    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures; i += 1) {
      expect((await login("wrong-pass")).statusCode).toBe(401);
    }

    const locked = await login("wrong-pass");
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

    const correctWhileLocked = await login(PASSWORD);
    expect(correctWhileLocked.statusCode).toBe(429);
  });

  it("成功登录清零失败计数,不因历史失败被锁", async () => {
    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      expect((await login("wrong-pass")).statusCode).toBe(401);
    }
    expect((await login(PASSWORD)).statusCode).toBe(200);

    for (let i = 0; i < LOGIN_LOCKOUT.maxFailures - 1; i += 1) {
      expect((await login("wrong-pass")).statusCode).toBe(401);
    }
  });
});

describe("管理员口令修改", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let keySeq = 0;

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
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  function changeHeaders(idempotencyKey?: string): Record<string, string> {
    return {
      cookie,
      "x-requested-with": "fetch",
      ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
    };
  }

  async function changePassword(
    currentPassword: string,
    newPassword: string,
    idempotencyKey = `pw-${++keySeq}`,
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: changeHeaders(idempotencyKey),
      payload: { currentPassword, newPassword },
    });
  }

  it("未登录改口令回 401,缺幂等键回 422", async () => {
    const anonymous = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { "x-requested-with": "fetch", "idempotency-key": "pw-anon" },
      payload: { currentPassword: PASSWORD, newPassword: "newsecret" },
    });
    expect(anonymous.statusCode).toBe(401);

    const noKey = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: changeHeaders(),
      payload: { currentPassword: PASSWORD, newPassword: "newsecret" },
    });
    expect(noKey.statusCode).toBe(422);
  });

  it("当前口令不对回 422,旧口令仍能登录", async () => {
    const response = await changePassword("wrong-pass", "newsecret");
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it("新口令与当前口令相同回 422", async () => {
    const response = await changePassword(PASSWORD, PASSWORD);
    expect(response.statusCode).toBe(422);
  });

  it("改完当前设备照常在用,其他设备会话被吊销,旧口令失效", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
    });
    const otherCookie = cookieOf(other);

    const response = await changePassword(PASSWORD, "newsecret");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, revokedSessions: 1 });

    const me = await app.inject({ method: "GET", url: "/api/overview", headers: { cookie } });
    expect(me.statusCode).toBe(200);

    const revoked = await app.inject({
      method: "GET",
      url: "/api/overview",
      headers: { cookie: otherCookie },
    });
    expect(revoked.statusCode).toBe(401);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "newsecret" },
    });
    expect(newLogin.statusCode).toBe(200);
  });
});
