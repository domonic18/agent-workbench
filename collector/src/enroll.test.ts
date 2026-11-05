import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { COLLECTOR_VERSION } from "./config.js";
import {
  credentialsPath,
  enrollMachine,
  loadCredentials,
  readEnrollToken,
  saveCredentials,
} from "./enroll.js";

const dirs: string[] = [];

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-enroll-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function stdinOf(content: string): PassThrough {
  const stream = new PassThrough();
  stream.end(content);
  return stream;
}

describe("readEnrollToken", () => {
  it("环境变量优先", async () => {
    expect(await readEnrollToken({ env: " ott_x ", stdin: stdinOf("piped") })).toBe("ott_x");
  });

  it("非 TTY stdin 读整段并 trim", async () => {
    expect(await readEnrollToken({ env: undefined, stdin: stdinOf("  ott-from-stdin\n") })).toBe(
      "ott-from-stdin",
    );
  });

  it("stdin 为空时落入交互隐藏输入", async () => {
    const prompted: string[] = [];
    const token = await readEnrollToken({
      env: undefined,
      stdin: stdinOf(""),
      prompt: async (prompt) => {
        prompted.push(prompt);
        return "ott-prompted";
      },
    });
    expect(token).toBe("ott-prompted");
    expect(prompted[0]).toContain("不回显");
  });
});

describe("credentials 文件", () => {
  it("保存后可读回,权限 0600,不在目录列表外扩散", () => {
    const dir = newDir();
    saveCredentials(dir, { consoleUrl: "https://aw.example.com", machineId: "m-1", secret: "s1" });
    expect(credentialsPath(dir)).toBe(join(dir, "credentials.json"));
    const loaded = loadCredentials(dir);
    expect(loaded).toEqual({ consoleUrl: "https://aw.example.com", machineId: "m-1", secret: "s1" });
    expect(statSync(credentialsPath(dir)).mode & 0o777).toBe(0o600);
  });

  it("缺失或损坏返回 null", () => {
    const dir = newDir();
    expect(loadCredentials(dir)).toBeNull();
    writeFileSync(credentialsPath(dir), "{broken");
    expect(loadCredentials(dir)).toBeNull();
    writeFileSync(credentialsPath(dir), JSON.stringify({ machineId: "m-1" }));
    expect(loadCredentials(dir)).toBeNull();
  });
});

describe("enrollMachine", () => {
  it("成功兑换:POST enroll 端点,返回 machine_id 与密钥", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({ machine_id: "m-abc123", collector_secret: "sec-1" }),
        { status: 201 },
      );
    }) as unknown as typeof fetch;

    const result = await enrollMachine({
      consoleUrl: "https://aw.example.com",
      token: "ott-once",
      hostname: "mini",
      os: "darwin",
      fetchImpl,
    });

    expect(result).toEqual({ machine_id: "m-abc123", collector_secret: "sec-1" });
    expect(calls[0]?.url).toBe("https://aw.example.com/api/aw-node/enroll");
    expect(calls[0]?.body).toMatchObject({
      token: "ott-once",
      hostname: "mini",
      os: "darwin",
      collector_version: COLLECTOR_VERSION,
    });
  });

  it("410/401 拒绝时抛错且不回显令牌", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "enroll token 无效或已失效" } }),
        { status: 410 },
      )) as unknown as typeof fetch;

    await expect(
      enrollMachine({ consoleUrl: "https://aw.example.com", token: "ott-bad", fetchImpl }),
    ).rejects.toThrow(/enroll token 无效或已失效/);
  });

  it("响应缺字段抛错", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 201 })) as unknown as typeof fetch;
    await expect(
      enrollMachine({ consoleUrl: "https://aw.example.com", token: "t", fetchImpl }),
    ).rejects.toThrow(/缺少 machine_id/);
  });
});
