import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { requireAllowedHost } from "./host.js";

function build(allowedHosts: readonly string[]) {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requireAllowedHost(allowedHosts));
  app.get("/probe", async () => ({ ok: true }));
  return app;
}

describe("Host 白名单", () => {
  it("白名单内的 Host 放行,大小写不敏感", async () => {
    const app = build(["aw.example.com:8787"]);

    const exact = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { host: "aw.example.com:8787" },
    });
    expect(exact.statusCode).toBe(200);

    const upper = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { host: "AW.EXAMPLE.COM:8787" },
    });
    expect(upper.statusCode).toBe(200);

    await app.close();
  });

  it("Host 不在白名单返回 403,端口不同也算不在", async () => {
    const app = build(["aw.example.com:8787"]);

    const wrongHost = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { host: "evil.example.com:8787" },
    });
    expect(wrongHost.statusCode).toBe(403);
    expect(wrongHost.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Host 不在白名单内" },
    });

    const wrongPort = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { host: "aw.example.com:9999" },
    });
    expect(wrongPort.statusCode).toBe(403);

    await app.close();
  });

  it("带 X-Forwarded-For 不改变准入结果", async () => {
    const app = build(["aw.example.com:8787"]);

    const spoofed = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { host: "evil.example.com:8787", "x-forwarded-for": "aw.example.com:8787" },
    });
    expect(spoofed.statusCode).toBe(403);

    await app.close();
  });
});
