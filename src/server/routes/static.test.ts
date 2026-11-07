import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("前端静态托管", () => {
  let root: string;
  let app: FastifyInstance;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aw-web-"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>工作台</title>");
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "app-abc123.js"), "console.log('ok')");
    app = buildApp({ logLevel: "silent", webRoot: root });
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("根路径返回 index.html", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("工作台");
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("前端路由回退 index.html", async () => {
    const response = await app.inject({ method: "GET", url: "/tasks/tsk_1" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("工作台");
  });

  it("静态资源带 MIME 与长缓存", async () => {
    const response = await app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/javascript");
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  it("缺失的带扩展名资源不回退 index.html", async () => {
    const response = await app.inject({ method: "GET", url: "/assets/missing.js" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("API 未知路径保持 JSON 404", async () => {
    const response = await app.inject({ method: "GET", url: "/api/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("阻止编码后的路径穿越", async () => {
    // 字面量 .. 会被 URL 规范化掉,这里用编码斜杠把穿越意图送进处理函数
    const response = await app.inject({
      method: "GET",
      url: "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    });
    expect(response.statusCode).toBe(404);
  });

  it("无 index.html 时跳过托管", async () => {
    const empty = mkdtempSync(join(tmpdir(), "aw-web-empty-"));
    const bare = buildApp({ logLevel: "silent", webRoot: empty });
    try {
      const response = await bare.inject({ method: "GET", url: "/" });
      expect(response.statusCode).toBe(404);
    } finally {
      await bare.close();
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("执行面安装脚本下发", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-install-"));
    writeFileSync(join(dir, "install-aw-node.sh"), "#!/bin/sh\necho aw-node\n");
    app = buildApp({ logLevel: "silent", installScriptPath: join(dir, "install-aw-node.sh") });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("匿名可读,按 shell 脚本类型下发", async () => {
    const response = await app.inject({ method: "GET", url: "/artifacts/install.sh" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/x-shellscript");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toContain("echo aw-node");
  });

  it("只暴露安装脚本本身,不开放目录", async () => {
    const response = await app.inject({ method: "GET", url: "/artifacts/backup.sh" });
    expect(response.statusCode).toBe(404);
  });
});
