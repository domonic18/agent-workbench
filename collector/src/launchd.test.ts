import { afterEach, describe, expect, it } from "vitest";
import { resolveInstallIdentity } from "./cli.js";
import type { EnrollCredentials } from "./enroll.js";
import { buildPlist, LABEL, LEGACY_LABEL, type InstallOptions } from "./launchd.js";

const CREDENTIALS: EnrollCredentials = {
  consoleUrl: "https://aw.example.com",
  machineId: "mach_1",
  secret: "sec-1",
};

function options(overrides: Partial<InstallOptions> = {}): InstallOptions {
  return {
    url: "https://aw.example.com/api/ingest",
    collectorId: "mach_1",
    secret: "sec-1",
    projects: ["proj"],
    stateDir: "/Users/t/.aw-node",
    backfill: false,
    label: LABEL,
    claudeDir: null,
    ccConnectDir: null,
    ...overrides,
  };
}

const PREV_ID = process.env.AW_COLLECTOR_ID;
const PREV_SECRET = process.env.AW_COLLECTOR_SECRET;

afterEach(() => {
  if (PREV_ID === undefined) {
    delete process.env.AW_COLLECTOR_ID;
  } else {
    process.env.AW_COLLECTOR_ID = PREV_ID;
  }
  if (PREV_SECRET === undefined) {
    delete process.env.AW_COLLECTOR_SECRET;
  } else {
    process.env.AW_COLLECTOR_SECRET = PREV_SECRET;
  }
});

describe("buildPlist", () => {
  it("写入 aw-node label、run 参数、密钥 env 与日志路径", () => {
    const plist = buildPlist(options(), "/Users/t/.local/bin/aw-node");
    expect(plist).toContain(`<string>${LABEL}</string>`);
    expect(plist).toContain("<string>run</string>");
    expect(plist).toContain("<key>AW_COLLECTOR_ID</key><string>mach_1</string>");
    expect(plist).toContain("<key>AW_COLLECTOR_SECRET</key><string>sec-1</string>");
    expect(plist).toContain("<string>/Users/t/.aw-node/aw-node.log</string>");
    expect(plist).toContain("<string>/Users/t/.aw-node/aw-node.err</string>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(plist).toContain("<key>AW_AGENT_PROJECTS</key><string>proj</string>");
  });

  it("空项目不写 AW_AGENT_PROJECTS,backfill 写 AW_BACKFILL", () => {
    const plist = buildPlist(options({ projects: [], backfill: true }), "/Users/t/.local/bin/aw-node");
    expect(plist).not.toContain("AW_AGENT_PROJECTS");
    expect(plist).toContain("<key>AW_BACKFILL</key><string>1</string>");
  });

  it("label 与旧基线 collector label 不同名,升级可并存检测", () => {
    expect(LABEL).not.toEqual(LEGACY_LABEL);
    expect(LABEL).toBe("com.agent-workbench.aw-node");
    expect(LEGACY_LABEL).toBe("com.agent-workbench.collector");
  });
});

describe("resolveInstallIdentity", () => {
  it("显式 --id 与环境密钥优先", () => {
    process.env.AW_COLLECTOR_ID = "mach_explicit";
    process.env.AW_COLLECTOR_SECRET = "sec-env";
    expect(resolveInstallIdentity(["--id", "mach_explicit"], CREDENTIALS)).toEqual({
      collectorId: "mach_explicit",
      secret: "sec-env",
    });
  });

  it("缺省时回退 enroll 凭据,升级无需重复输入", () => {
    delete process.env.AW_COLLECTOR_ID;
    delete process.env.AW_COLLECTOR_SECRET;
    expect(resolveInstallIdentity([], CREDENTIALS)).toEqual({
      collectorId: "mach_1",
      secret: "sec-1",
    });
  });

  it("两边都缺时报错并指向 enroll", () => {
    delete process.env.AW_COLLECTOR_ID;
    delete process.env.AW_COLLECTOR_SECRET;
    expect(() => resolveInstallIdentity([], null)).toThrow(/aw-node enroll/);
  });
});
