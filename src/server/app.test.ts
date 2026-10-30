import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("buildApp", () => {
  it("GET /healthz 返回 200 与版本号", async () => {
    const app = buildApp({ logLevel: "silent" });
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; version: string; uptime: number };
    expect(body.status).toBe("ok");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.uptime).toBeGreaterThanOrEqual(0);

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
});
