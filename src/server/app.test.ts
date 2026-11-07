import { describe, expect, it } from "vitest";
import { openDatabase } from "../store/database.js";
import { ensureConsoleCredential } from "./credential.js";
import { buildApp } from "./app.js";

describe("buildApp", () => {
  it("GET /healthz 返回 200 与版本号", async () => {
    const app = buildApp({ logLevel: "silent" });
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      version: string;
      db: string;
      uptime: number;
    };
    expect(body.status).toBe("ok");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.db).toBe("ok");
    expect(body.uptime).toBeGreaterThanOrEqual(0);

    await app.close();
  });

  it("库不可写时 /healthz 返回 503", async () => {
    const app = buildApp({ logLevel: "silent", databaseStatus: () => "unavailable" });
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "degraded", db: "unavailable" });

    await app.close();
  });

  it("配置 allowedHosts 后,Host 不在白名单的请求被拒", async () => {
    const app = buildApp({ logLevel: "silent", allowedHosts: ["127.0.0.1:8787"] });

    const allowed = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { host: "127.0.0.1:8787" },
    });
    expect(allowed.statusCode).toBe(200);

    const denied = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { host: "evil.example.com:8787" },
    });
    expect(denied.statusCode).toBe(403);

    await app.close();
  });

  it("未知路由返回 404 错误信封", async () => {
    const app = buildApp({ logLevel: "silent" });
    const response = await app.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "not found" },
    });

    await app.close();
  });

  it("响应带基础安全头,被拒与未命中路由同样带", async () => {
    const app = buildApp({ logLevel: "silent", allowedHosts: ["127.0.0.1:8787"] });

    const ok = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { host: "127.0.0.1:8787" },
    });
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    expect(ok.headers["x-frame-options"]).toBe("DENY");
    expect(ok.headers["referrer-policy"]).toBe("no-referrer");
    expect(ok.headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");

    const denied = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { host: "evil.example.com:8787" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers["x-frame-options"]).toBe("DENY");

    const missing = await app.inject({
      method: "GET",
      url: "/nope",
      headers: { host: "127.0.0.1:8787" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["x-content-type-options"]).toBe("nosniff");

    await app.close();
  });

  it("只注入 db 时也注册身份与 A2A 路由(返回 401 而非 404)", async () => {
    const db = await openDatabase();
    await ensureConsoleCredential(db, "simple-123456");
    const app = buildApp({ logLevel: "silent", db });

    expect((await app.inject({ method: "GET", url: "/api/machines" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/a2a/inbox" })).statusCode).toBe(401);

    await app.close();
    await db.close();
  });
});

describe("会话 cookie 的 Secure 标记", () => {
  async function loginWith(
    trustProxy: boolean,
    headers: Record<string, string> = {},
  ): Promise<string> {
    const db = await openDatabase();
    await ensureConsoleCredential(db, "simple-123456");
    const app = buildApp({ logLevel: "silent", db, trustProxy });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { password: "simple-123456" },
    });
    expect(response.statusCode).toBe(200);
    const raw = response.headers["set-cookie"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    await app.close();
    await db.close();
    if (value === undefined) {
      throw new Error("登录响应没有 set-cookie");
    }
    return value;
  }

  it("未开启可信代理时不因转发头加 Secure", async () => {
    const cookie = await loginWith(false, { "x-forwarded-proto": "https" });
    expect(cookie).not.toContain("Secure");
  });

  it("开启可信代理且请求来自 https 时加 Secure", async () => {
    const cookie = await loginWith(true, { "x-forwarded-proto": "https" });
    expect(cookie).toContain("; Secure");
  });

  it("开启可信代理但请求仍是 http 时不加 Secure", async () => {
    const cookie = await loginWith(true);
    expect(cookie).not.toContain("Secure");
  });
});
