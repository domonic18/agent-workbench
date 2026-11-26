import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret1234567";

function settingsHeaders(cookie: string, idempotencyKey: string): Record<string, string> {
  return {
    cookie,
    "x-requested-with": "fetch",
    "idempotency-key": idempotencyKey,
  };
}

describe("设置 API", () => {
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
    const raw = login.headers["set-cookie"];
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (first === undefined) {
      throw new Error("登录响应没有 cookie");
    }
    cookie = first.split(";")[0] as string;
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it("GET 未登录回 401,密钥只回 configured 不回值", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/settings" });
    expect(anonymous.statusCode).toBe(401);

    await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: settingsHeaders(cookie, `settings-${++keySeq}`),
      payload: { feishuAppSecret: "should-not-leak" },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.values["feishu_app_secret"]).toBe(true);
    expect(JSON.stringify(body)).not.toContain("should-not-leak");
  });

  it("PUT 改热读项不提示重启,改启动项提示重启", async () => {
    const hot = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: settingsHeaders(cookie, `settings-${++keySeq}`),
      payload: { publicUrl: "https://hot.example.com" },
    });
    expect(hot.json()).toMatchObject({ ok: true, restartRequired: false });

    const boot = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: settingsHeaders(cookie, `settings-${++keySeq}`),
      payload: { feishuAppId: "cli_app" },
    });
    expect(boot.json()).toMatchObject({ ok: true, restartRequired: true });
  });

  it("PUT 密钥空串保持原值", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: settingsHeaders(cookie, `settings-${++keySeq}`),
      payload: { githubWebhookSecret: "original" },
    });
    const keep = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: settingsHeaders(cookie, `settings-${++keySeq}`),
      payload: { publicUrl: "https://example.com", githubWebhookSecret: "" },
    });
    expect(keep.statusCode).toBe(200);

    const get = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie },
    });
    expect(get.json().values["github_webhook_secret"]).toBe(true);
  });
});
