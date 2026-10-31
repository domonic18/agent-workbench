import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS } from "../../shared/constants.js";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { findActiveSession } from "../../store/repositories/session.js";
import {
  clearSessionCookie,
  parseCookies,
  requireCsrf,
  requireIdempotencyKey,
  requireSession,
  SESSION_COOKIE,
  sessionCookie,
  startSession,
  endSession,
} from "./session.js";

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

describe("cookie 与会话", () => {
  it("解析 Cookie 头并忽略空段", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("a=1; b=two; broken; =x")).toEqual({ a: "1", b: "two" });
  });

  it("会话 cookie 带 HttpOnly / SameSite=Lax / 12h", () => {
    expect(sessionCookie("abc")).toBe(
      `${SESSION_COOKIE}=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`,
    );
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });

  it("会话按库中 expires_at 过期", () => {
    const db = prepare();
    let clock = 1_000;
    const { id } = startSession(db, () => clock);

    expect(findActiveSession(db, id, clock)).toBeDefined();
    clock += SESSION_TTL_MS - 1;
    expect(findActiveSession(db, id, clock)).toBeDefined();
    clock += 1;
    expect(findActiveSession(db, id, clock)).toBeUndefined();

    endSession(db, id);
    clock = 0;
    expect(findActiveSession(db, id, clock)).toBeUndefined();
    db.close();
  });

  it("缺失或过期的会话返回 401", async () => {
    const db = prepare();
    let clock = 1_000;
    const app = Fastify();
    app.get("/me", { preHandler: requireSession(db, () => clock) }, async () => ({
      ok: true,
    }));

    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);

    const { id } = startSession(db, () => clock);
    const ok = await app.inject({ method: "GET", url: "/me", headers: { cookie: `aw_session=${id}` } });
    expect(ok.statusCode).toBe(200);

    clock += SESSION_TTL_MS;
    const expired = await app.inject({
      method: "GET",
      url: "/me",
      headers: { cookie: `aw_session=${id}` },
    });
    expect(expired.statusCode).toBe(401);

    await app.close();
    db.close();
  });
});

describe("CSRF 与幂等键 preHandler", () => {
  it("非只读请求缺 X-Requested-With 返回 403", async () => {
    const app = Fastify();
    app.post("/write", { preHandler: requireCsrf() }, async () => ({ ok: true }));

    expect(
      (await app.inject({ method: "GET", url: "/write" })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: "POST", url: "/write" })).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/write",
          headers: { "x-requested-with": "XMLHttpRequest" },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });

  it("Origin 与 Host 不一致时拒绝跨站请求", async () => {
    const app = Fastify();
    app.post("/write", { preHandler: requireCsrf() }, async () => ({ ok: true }));

    const cross = await app.inject({
      method: "POST",
      url: "/write",
      headers: {
        host: "console.local",
        origin: "https://evil.example",
        "x-requested-with": "XMLHttpRequest",
      },
    });
    expect(cross.statusCode).toBe(403);

    const same = await app.inject({
      method: "POST",
      url: "/write",
      headers: {
        host: "console.local",
        origin: "http://console.local",
        "x-requested-with": "XMLHttpRequest",
      },
    });
    expect(same.statusCode).toBe(200);
    await app.close();
  });

  it("写操作缺 Idempotency-Key 返回 422", async () => {
    const app = Fastify();
    app.post("/write", { preHandler: requireIdempotencyKey() }, async () => ({ ok: true }));

    expect((await app.inject({ method: "POST", url: "/write" })).statusCode).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/write",
          headers: { "idempotency-key": "  " },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/write",
          headers: { "idempotency-key": "k1" },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });
});
