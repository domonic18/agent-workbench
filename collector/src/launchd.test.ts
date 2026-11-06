import { afterEach, describe, expect, it } from "vitest";
import { resolveInstallIdentity } from "./cli.js";
import type { EnrollCredentials } from "./enroll.js";
import {
  buildPlist,
  domainTargets,
  LABEL,
  LEGACY_LABEL,
  loadService,
  type InstallOptions,
  type LaunchctlRunner,
} from "./launchd.js";

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
    const plist = buildPlist(options(), ["/Users/t/.local/bin/aw-node", "run"]);
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
    const plist = buildPlist(options({ projects: [], backfill: true }), [
      "/Users/t/.local/bin/aw-node",
      "run",
    ]);
    expect(plist).not.toContain("AW_AGENT_PROJECTS");
    expect(plist).toContain("<key>AW_BACKFILL</key><string>1</string>");
  });

  it("label 与旧基线 collector label 不同名,升级可并存检测", () => {
    expect(LABEL).not.toEqual(LEGACY_LABEL);
    expect(LABEL).toBe("com.agent-workbench.aw-node");
    expect(LEGACY_LABEL).toBe("com.agent-workbench.collector");
  });
});

describe("loadService", () => {
  const PLIST = "/Users/t/Library/LaunchAgents/com.agent-workbench.aw-node.plist";
  const DIAGNOSTICS = { binary: "/Users/t/.local/bin/aw-node(已校验可执行)", plist: "通过" };

  function runner(handler: (args: string[]) => { status: number; stdout?: string; stderr?: string }) {
    return ((args: string[]) => {
      const result = handler(args);
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    }) as LaunchctlRunner;
  }

  it("gui 域装载失败时退回 user 域", () => {
    const run = runner((args) => {
      const joined = args.join(" ");
      if (joined === "print gui/501" || joined === "print user/501") {
        return { status: 0 };
      }
      if (joined === "bootstrap gui/501 " + PLIST) {
        return { status: 1, stderr: "Bootstrap failed: 5: Input/output error" };
      }
      if (joined === "bootstrap user/501 " + PLIST) {
        return { status: 0 };
      }
      return { status: 1, stderr: "unexpected: " + joined };
    });

    const outcome = loadService(PLIST, LABEL, run, domainTargets(501), DIAGNOSTICS);

    expect(outcome.domain).toBe("user/501");
    expect(outcome.bootedOut).toBe(false);
  });

  it("同名服务已挂着时先摘再装", () => {
    let bootedOut = false;
    const run = runner((args) => {
      const joined = args.join(" ");
      if (joined === "print gui/501") {
        return { status: 0 };
      }
      if (joined === `print gui/501/${LABEL}`) {
        return { status: bootedOut ? 1 : 0 };
      }
      if (joined === "bootstrap gui/501 " + PLIST) {
        return bootedOut
          ? { status: 0 }
          : { status: 1, stderr: "Bootstrap failed: 5: Input/output error" };
      }
      if (joined === `bootout gui/501/${LABEL}`) {
        bootedOut = true;
        return { status: 0 };
      }
      return { status: 1, stderr: "unexpected: " + joined };
    });

    const outcome = loadService(PLIST, LABEL, run, ["gui/501"], DIAGNOSTICS);

    expect(outcome.domain).toBe("gui/501");
    expect(outcome.bootedOut).toBe(true);
  });

  it("服务正在拆除(域里已查不到)时重试即成功", () => {
    let attempts = 0;
    const run = runner((args) => {
      const joined = args.join(" ");
      if (joined === "print gui/501") {
        return { status: 0 };
      }
      if (joined.startsWith("print gui/501/")) {
        return { status: 1 };
      }
      if (joined === "bootstrap gui/501 " + PLIST) {
        attempts += 1;
        return attempts >= 2
          ? { status: 0 }
          : { status: 1, stderr: "Bootstrap failed: 5: Input/output error" };
      }
      return { status: 1, stderr: "unexpected: " + joined };
    });

    const outcome = loadService(PLIST, LABEL, run, ["gui/501"], DIAGNOSTICS);

    expect(outcome.domain).toBe("gui/501");
    expect(outcome.bootedOut).toBe(false);
  });

  it("全域失败时给出诊断与手动重试命令", () => {
    const loaded = new Set<string>();
    const run = runner((args) => {
      const joined = args.join(" ");
      if (joined === "print gui/501" || joined === "print user/501") {
        return { status: 0 };
      }
      if (joined.startsWith("print ")) {
        return { status: loaded.has(joined.slice("print ".length)) ? 0 : 1 };
      }
      if (joined.startsWith("bootout ")) {
        loaded.delete(joined.slice("bootout ".length));
        return { status: 0 };
      }
      return { status: 1, stderr: "Bootstrap failed: 5: Input/output error" };
    });

    expect(() => loadService(PLIST, LABEL, run, domainTargets(501), DIAGNOSTICS)).toThrow(
      /launchd 装载失败[\s\S]*gui\/501: Bootstrap failed[\s\S]*user\/501[\s\S]*手动重试/,
    );
  });

  it("域都不可达时直接说明会话没有可用 launchd 域", () => {
    const run = runner(() => ({ status: 1, stderr: "Could not find service" }));

    expect(() => loadService(PLIST, LABEL, run, domainTargets(501), DIAGNOSTICS)).toThrow(
      /launchd 域不可达/,
    );
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
