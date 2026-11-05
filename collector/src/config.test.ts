import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLLECTOR_VERSION, loadConfig, normalizeIngestUrl, parseBackfill } from "./config.js";

describe("采集器配置", () => {
  it("版本号与 collector/package.json 一致,避免发布产物自报旧版本", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { version: string };
    expect(COLLECTOR_VERSION).toBe(pkg.version);
  });

  it("接受 base url 或完整 ingest url", () => {
    expect(normalizeIngestUrl("https://aw.example.com")).toEqual({
      ingestUrl: "https://aw.example.com/api/ingest",
      baseUrl: "https://aw.example.com",
    });
    expect(normalizeIngestUrl("https://aw.example.com/api/ingest/")).toEqual({
      ingestUrl: "https://aw.example.com/api/ingest",
      baseUrl: "https://aw.example.com",
    });
  });

  it("默认从文件末尾开始,显式开启才回读历史", () => {
    expect(parseBackfill(undefined)).toBe("none");
    expect(parseBackfill("1")).toBe("all");
    expect(() => parseBackfill("partial")).toThrow();
  });

  it("缺采集器身份时拒绝启动", () => {
    expect(() => loadConfig({ env: {} })).toThrow(/AW_COLLECTOR_ID/);
    expect(() => loadConfig({ env: { AW_COLLECTOR_ID: "m1" } })).toThrow(/AW_COLLECTOR_SECRET/);
  });

  it("解析项目列表与数值边界", () => {
    const config = loadConfig({
      env: {
        AW_COLLECTOR_ID: "m1",
        AW_COLLECTOR_SECRET: "s",
        AW_AGENT_PROJECTS: " a, b ,, ",
        AW_POLL_MS: "2000",
        AW_BATCH_MAX: "500",
        AW_BACKFILL: "all",
      },
    });
    expect(config.registeredProjects).toEqual(["a", "b"]);
    expect(config.pollMs).toBe(2_000);
    expect(config.batchMax).toBe(500);
    expect(config.backfill).toBe("all");
    expect(config.ingestUrl).toBe("http://127.0.0.1:8787/api/ingest");
  });

  it("非法数值直接报错", () => {
    expect(() =>
      loadConfig({
        env: { AW_COLLECTOR_ID: "m1", AW_COLLECTOR_SECRET: "s", AW_POLL_MS: "0" },
      }),
    ).toThrow(/AW_POLL_MS/);
    expect(() =>
      loadConfig({
        env: { AW_COLLECTOR_ID: "m1", AW_COLLECTOR_SECRET: "s", AW_BATCH_MAX: "501" },
      }),
    ).toThrow(/AW_BATCH_MAX/);
  });

  it("调度参数:默认开启 30s 轮询,AW_DISPATCH_MS=0 关闭", () => {
    const base = { AW_COLLECTOR_ID: "m1", AW_COLLECTOR_SECRET: "s" };
    const defaults = loadConfig({ env: base });
    expect(defaults.dispatchMs).toBe(30_000);
    expect(defaults.sessionTimeoutMs).toBe(30 * 60_000);
    expect(defaults.dispatchModel).toBeNull();
    expect(defaults.dispatchClaude).toBeNull();

    const off = loadConfig({ env: { ...base, AW_DISPATCH_MS: "0" } });
    expect(off.dispatchMs).toBe(0);

    const tuned = loadConfig({
      env: {
        ...base,
        AW_DISPATCH_MS: "5000",
        AW_SESSION_TIMEOUT_MS: "600000",
        AW_DISPATCH_MODEL: "claude-sonnet-4-6",
        AW_DISPATCH_CLAUDE: "/opt/homebrew/bin/claude",
      },
    });
    expect(tuned.dispatchMs).toBe(5_000);
    expect(tuned.sessionTimeoutMs).toBe(600_000);
    expect(tuned.dispatchModel).toBe("claude-sonnet-4-6");
    expect(tuned.dispatchClaude).toBe("/opt/homebrew/bin/claude");
  });

  it("调度数值越界报错", () => {
    const base = { AW_COLLECTOR_ID: "m1", AW_COLLECTOR_SECRET: "s" };
    expect(() => loadConfig({ env: { ...base, AW_DISPATCH_MS: "-1" } })).toThrow(/AW_DISPATCH_MS/);
    expect(() =>
      loadConfig({ env: { ...base, AW_SESSION_TIMEOUT_MS: "1000" } }),
    ).toThrow(/AW_SESSION_TIMEOUT_MS/);
  });
});
