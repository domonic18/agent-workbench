import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOGIN_LOCKOUT } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";

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
