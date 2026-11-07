import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { listArtifacts, registerArtifactRoutes } from "./artifacts.js";

const DIGEST = "a".repeat(64);

let dir: string | undefined;

function fixtureDir(): string {
  dir = mkdtempSync(join(tmpdir(), "aw-artifacts-"));
  writeFileSync(join(dir, "aw-node-macos-arm64"), "binary-bytes");
  writeFileSync(join(dir, "checksums.txt"), `${DIGEST}  aw-node-macos-arm64\n`);
  return dir;
}

afterEach(() => {
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe("执行面产物下发", () => {
  it("只按白名单下发产物,校验和随产物同源", async () => {
    const app = Fastify({ logger: { level: "silent" } });
    registerArtifactRoutes(app, fixtureDir());
    await app.ready();

    const asset = await app.inject({ method: "GET", url: "/artifacts/aw-node-macos-arm64" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toBe("application/octet-stream");
    expect(asset.body).toBe("binary-bytes");

    const sums = await app.inject({ method: "GET", url: "/artifacts/checksums.txt" });
    expect(sums.statusCode).toBe(200);
    expect(sums.body).toContain(DIGEST);

    await app.close();
  });

  it("非白名单文件名一律 404,不做目录浏览", async () => {
    const app = Fastify({ logger: { level: "silent" } });
    registerArtifactRoutes(app, fixtureDir());
    await app.ready();

    const hidden = await app.inject({ method: "GET", url: "/artifacts/aw-node-macos-x64" });
    expect(hidden.statusCode).toBe(404);
    const other = await app.inject({ method: "GET", url: "/artifacts/other.txt" });
    expect(other.statusCode).toBe(404);

    await app.close();
  });

  it("产物目录缺失时返回 404,安装脚本回退 GitHub Release", async () => {
    const app = Fastify({ logger: { level: "silent" } });
    registerArtifactRoutes(app, join(tmpdir(), "aw-artifacts-missing"));
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/artifacts/aw-node-macos-arm64" });
    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it("产物在启动之后才出现时,路由仍可取件", async () => {
    const app = Fastify({ logger: { level: "silent" } });
    const root = mkdtempSync(join(tmpdir(), "aw-artifacts-late-"));
    registerArtifactRoutes(app, root);
    await app.ready();

    expect((await app.inject({ method: "GET", url: "/artifacts/aw-node-macos-arm64" })).statusCode).toBe(404);
    writeFileSync(join(root, "aw-node-macos-arm64"), "late-binary");
    const late = await app.inject({ method: "GET", url: "/artifacts/aw-node-macos-arm64" });
    expect(late.statusCode).toBe(200);
    expect(late.body).toBe("late-binary");

    rmSync(root, { recursive: true, force: true });
    await app.close();
  });
});

describe("产物清单", () => {
  it("列出产物名、大小与校验和;缺产物不出现在清单里", () => {
    const entries = listArtifacts(fixtureDir());
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("aw-node-macos-arm64");
    expect(entries[0]?.sha256).toBe(DIGEST);
    expect(entries[0]?.size).toBe("binary-bytes".length);
  });

  it("目录不存在时返回空清单", () => {
    expect(listArtifacts(join(tmpdir(), "aw-artifacts-missing"))).toEqual([]);
  });
});
