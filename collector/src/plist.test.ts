import { describe, expect, it } from "vitest";
import { buildEnv, buildPlist, parsePlistEnv, type InstallOptions } from "./plist.js";

function options(overrides: Partial<InstallOptions> = {}): InstallOptions {
  return {
    url: "https://aw.example.com/api/ingest",
    collectorId: "mach_1",
    secret: "sec-1",
    projects: ["proj"],
    stateDir: "/Users/t/.aw-node",
    backfill: false,
    label: "com.agent-workbench.aw-node",
    claudeDir: null,
    ccConnectDir: null,
    ...overrides,
  };
}

describe("buildPlist", () => {
  it("写入 aw-node label、run 参数、密钥 env 与日志路径", () => {
    const plist = buildPlist(options(), ["/Users/t/.local/bin/aw-node", "run"]);
    expect(plist).toContain("<string>com.agent-workbench.aw-node</string>");
    expect(plist).toContain("<string>run</string>");
    expect(plist).toContain("<key>AW_COLLECTOR_ID</key><string>mach_1</string>");
    expect(plist).toContain("<key>AW_COLLECTOR_SECRET</key><string>sec-1</string>");
    expect(plist).toContain("<string>/Users/t/.aw-node/aw-node.log</string>");
    expect(plist).toContain("<string>/Users/t/.aw-node/aw-node.err</string>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(plist).toContain("<key>AW_AGENT_PROJECTS</key><string>proj</string>");
  });

  it("空项目不写 AW_AGENT_PROJECTS,backfill 写 AW_BACKFILL", () => {
    const plist = buildPlist(options({ projects: [], backfill: true }), [
      "/Users/t/.local/bin/aw-node",
      "run",
    ]);
    expect(plist).not.toContain("AW_AGENT_PROJECTS");
    expect(plist).toContain("<key>AW_BACKFILL</key><string>1</string>");
  });
});

describe("parsePlistEnv", () => {
  it("读出既有 plist 的环境变量", () => {
    const xml = `<plist><dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AW_STATE_DIR</key><string>/Users/t/.aw-node</string>
    <key>GH_TOKEN</key><string>ghp_x</string>
  </dict>
</dict></plist>`;
    expect(parsePlistEnv(xml)).toEqual({
      AW_STATE_DIR: "/Users/t/.aw-node",
      GH_TOKEN: "ghp_x",
    });
  });

  it("没有 EnvironmentVariables 时返回空", () => {
    expect(parsePlistEnv("<plist><dict></dict></plist>")).toEqual({});
  });

  it("转义字符还原", () => {
    const xml = `<plist><dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AW_EXTRA_PROJECTS</key><string>a=/tmp/a&amp;b</string>
  </dict>
</dict></plist>`;
    expect(parsePlistEnv(xml).AW_EXTRA_PROJECTS).toBe("a=/tmp/a&b");
  });
});

describe("buildEnv", () => {
  it("保留既有自定义环境变量", () => {
    const env = buildEnv(options(), { GH_TOKEN: "ghp_x", AW_EXTRA_PROJECTS: "a=/tmp/a" });
    expect(env.GH_TOKEN).toBe("ghp_x");
    expect(env.AW_EXTRA_PROJECTS).toBe("a=/tmp/a");
  });

  it("install 掌控的键由本次参数决定,覆盖既有值", () => {
    const env = buildEnv(
      options({ url: "https://new/api/ingest", collectorId: "mach_2", secret: "sec-2" }),
      { AW_INGEST_URL: "https://old/api/ingest", AW_COLLECTOR_ID: "mach_1", AW_COLLECTOR_SECRET: "sec-1" },
    );
    expect(env.AW_INGEST_URL).toBe("https://new/api/ingest");
    expect(env.AW_COLLECTOR_ID).toBe("mach_2");
    expect(env.AW_COLLECTOR_SECRET).toBe("sec-2");
  });

  it("没显式传的项目列表与 backfill 沿用既有值", () => {
    const env = buildEnv(options({ projects: [], backfill: false }), {
      AW_AGENT_PROJECTS: "keep-me",
      AW_BACKFILL: "1",
    });
    expect(env.AW_AGENT_PROJECTS).toBe("keep-me");
    expect(env.AW_BACKFILL).toBe("1");
  });

  it("显式传入才覆盖既有值", () => {
    const env = buildEnv(options({ projects: ["new"], backfill: true }), {
      AW_AGENT_PROJECTS: "old",
      AW_BACKFILL: "1",
    });
    expect(env.AW_AGENT_PROJECTS).toBe("new");
    expect(env.AW_BACKFILL).toBe("1");
  });
});
