import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FeishuOauthError, type FeishuOauthUser } from "../../adapters/feishu/oauth.js";
import type { FeishuConfig } from "../../config/env.js";
import { LOGIN_LOCKOUT } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret1234567";

const FEISHU: FeishuConfig = {
  appId: "cli_app",
  appSecret: "sec_app",
  allowedOpenIds: ["ou_member"],
  approvalChatId: undefined,
  collabChatId: undefined,
};

const MEMBER: FeishuOauthUser = { openId: "ou_member", unionId: "un_member", name: "管理员" };
const OUTSIDER: FeishuOauthUser = { openId: "ou_other", unionId: "un_other", name: "路人" };

function exchangeStub(user: FeishuOauthUser): () => Promise<FeishuOauthUser> {
  return async () => user;
}

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
      payload: { currentPassword: PASSWORD, newPassword: "newsecret12345" },
    });
    expect(anonymous.statusCode).toBe(401);

    const noKey = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: changeHeaders(),
      payload: { currentPassword: PASSWORD, newPassword: "newsecret12345" },
    });
    expect(noKey.statusCode).toBe(422);
  });

  it("当前口令不对回 422,旧口令仍能登录", async () => {
    const response = await changePassword("wrong-pass", "newsecret12345");
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

    const response = await changePassword(PASSWORD, "newsecret12345");
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
      payload: { password: "newsecret12345" },
    });
    expect(newLogin.statusCode).toBe(200);
  });
});

describe("飞书免登", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = await openDatabase();
    await ensureConsoleCredential(db, PASSWORD);
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  function feishuLogin(
    code = "auth-code-1234",
    exchange: () => Promise<FeishuOauthUser> = exchangeStub(MEMBER),
  ): Promise<LightMyRequestResponse> {
    app = buildApp({
      logLevel: "silent",
      db,
      feishu: FEISHU,
      exchangeFeishuCode: async () => exchange(),
    });
    return app.inject({ method: "POST", url: "/api/auth/feishu/login", payload: { code } });
  }

  it("未配置飞书或白名单为空时,status 关闭且不回 appId", async () => {
    app = buildApp({ logLevel: "silent", db });
    const none = await app.inject({ method: "GET", url: "/api/auth/feishu/status" });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ enabled: false, appId: "" });

    app = buildApp({
      logLevel: "silent",
      db,
      feishu: { ...FEISHU, allowedOpenIds: [] },
    });
    const empty = await app.inject({ method: "GET", url: "/api/auth/feishu/status" });
    expect(empty.json()).toEqual({ enabled: false, appId: "" });
  });

  it("白名单非空时 status 开启并回 appId", async () => {
    app = buildApp({ logLevel: "silent", db, feishu: FEISHU });
    const status = await app.inject({ method: "GET", url: "/api/auth/feishu/status" });
    expect(status.json()).toEqual({ enabled: true, appId: "cli_app" });
  });

  it("白名单内 open_id 免登成功,会话与口令登录同权", async () => {
    const response = await feishuLogin();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(response.headers["set-cookie"]).toBeDefined();

    const overview = await app.inject({
      method: "GET",
      url: "/api/overview",
      headers: { cookie: cookieOf(response) },
    });
    expect(overview.statusCode).toBe(200);
  });

  it("白名单外 open_id 回 401,不发会话", async () => {
    const response = await feishuLogin("auth-code-1234", exchangeStub(OUTSIDER));
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("code 格式非法回 422", async () => {
    const response = await feishuLogin("short");
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("出站错误按适配器状态码映射(不可达 502 / 授权码无效 401)", async () => {
    const unreachable = await feishuLogin(
      "auth-code-1234",
      async () => {
        throw new FeishuOauthError("FEISHU_UNREACHABLE", "飞书服务不可达,请稍后重试", 502);
      },
    );
    expect(unreachable.statusCode).toBe(502);
    expect(unreachable.json()).toMatchObject({ error: { code: "FEISHU_UNREACHABLE" } });

    const invalidCode = await feishuLogin(
      "auth-code-1234",
      async () => {
        throw new FeishuOauthError("FEISHU_CODE_INVALID", "飞书授权码无效或已过期", 401);
      },
    );
    expect(invalidCode.statusCode).toBe(401);
  });

  it("同 IP 超过限流阈值回 429", async () => {
    app = buildApp({
      logLevel: "silent",
      db,
      feishu: FEISHU,
      exchangeFeishuCode: exchangeStub(MEMBER),
    });
    for (let i = 0; i < 30; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/feishu/login",
        payload: { code: "auth-code-1234" },
      });
      expect(response.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/feishu/login",
      payload: { code: "auth-code-1234" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("控制台未初始化时免登端点回 403 BOOTSTRAP_REQUIRED", async () => {
    const bootstrapDb = await openDatabase();
    const bootstrapApp = buildApp({ logLevel: "silent", db: bootstrapDb, feishu: FEISHU });
    try {
      const status = await bootstrapApp.inject({ method: "GET", url: "/api/auth/feishu/status" });
      expect(status.statusCode).toBe(403);
      expect(status.json()).toMatchObject({ error: { code: "BOOTSTRAP_REQUIRED" } });

      const login = await bootstrapApp.inject({
        method: "POST",
        url: "/api/auth/feishu/login",
        payload: { code: "auth-code-1234" },
      });
      expect(login.statusCode).toBe(403);
    } finally {
      await bootstrapApp.close();
      await bootstrapDb.close();
    }
  });
});
