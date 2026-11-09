import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackoffTracker,
  DISPATCH_BACKOFF_MS,
  probeWorktreeDirty,
  reportHoldToConsole,
  runGates,
  type GateDeps,
  type GateInput,
} from "./dispatch-gates.js";
import { createLogger } from "./log.js";

const exec = promisify(execFile);

const dirs: string[] = [];

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-gates-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function gateDeps(overrides: Partial<GateDeps> = {}): GateDeps {
  return {
    activity: { cwdActive: () => false, activeCount: 0 },
    probeDirty: async () => false,
    reportHold: async () => {},
    maxMachineSessions: 2,
    requestTimeoutMs: 30_000,
    logger: createLogger({ level: "error" }),
    ...overrides,
  };
}

function gateInput(overrides: Partial<GateInput> = {}): GateInput {
  return { agentId: "agt_a", cwd: "/repo", isWorkDispatch: true, ...overrides };
}

describe("runGates 闸门链", () => {
  it("G2 cwd 会话活跃:挡下并上报挂起原因(工作派发)", async () => {
    const holds: string[] = [];
    const outcome = await runGates(
      gateDeps({
        activity: { cwdActive: () => true, activeCount: 1 },
        reportHold: async (reason) => {
          holds.push(reason);
        },
      }),
      gateInput(),
    );
    expect(outcome).toBe("cwd_session_active");
    expect(holds).toEqual(["cwd_session_active"]);
  });

  it("G2 挡下时不探脏工作区(闸门短路)", async () => {
    const probed: string[] = [];
    const outcome = await runGates(
      gateDeps({
        activity: { cwdActive: () => true, activeCount: 1 },
        probeDirty: async (cwd) => {
          probed.push(cwd);
          return false;
        },
      }),
      gateInput(),
    );
    expect(outcome).toBe("cwd_session_active");
    expect(probed).toEqual([]);
  });

  it("G3 脏工作区:挡下并上报;探测失败 WARN 放行", async () => {
    const holds: string[] = [];
    expect(
      await runGates(
        gateDeps({
          probeDirty: async () => true,
          reportHold: async (reason) => {
            holds.push(reason);
          },
        }),
        gateInput(),
      ),
    ).toBe("dirty_worktree");
    expect(holds).toEqual(["dirty_worktree"]);

    expect(await runGates(gateDeps({ probeDirty: async () => "unknown" }), gateInput())).toBe("pass");
    expect(holds).toEqual(["dirty_worktree"]);
  });

  it("G4 机级上限:达到即挡,不上报挂起原因(软闸门)", async () => {
    const holds: string[] = [];
    const outcome = await runGates(
      gateDeps({
        activity: { cwdActive: () => false, activeCount: 2 },
        reportHold: async (reason) => {
          holds.push(reason);
        },
      }),
      gateInput(),
    );
    expect(outcome).toBe("machine_limit");
    expect(holds).toEqual([]);
  });

  it("a2a 派发被挡也不上报:a2a 收件箱没有 pending 行", async () => {
    const holds: string[] = [];
    const outcome = await runGates(
      gateDeps({
        probeDirty: async () => true,
        reportHold: async (reason) => {
          holds.push(reason);
        },
      }),
      gateInput({ isWorkDispatch: false }),
    );
    expect(outcome).toBe("dirty_worktree");
    expect(holds).toEqual([]);
  });

  it("上报失败不吞闸门结果", async () => {
    const outcome = await runGates(
      gateDeps({
        probeDirty: async () => true,
        reportHold: async () => {
          throw new Error("HTTP 500");
        },
      }),
      gateInput(),
    );
    expect(outcome).toBe("dirty_worktree");
  });
});

describe("BackoffTracker 连续被挡退避", () => {
  const t0 = 1_000_000;

  it("连续被挡达 rounds 触发退避并清零计数;退避期内不 eligible,到期恢复", () => {
    const tracker = new BackoffTracker();
    expect(tracker.eligible("agt_a", t0)).toBe(true);
    expect(tracker.recordBlocked("agt_a", t0, 3)).toBe(false);
    expect(tracker.recordBlocked("agt_a", t0 + 1, 3)).toBe(false);
    expect(tracker.recordBlocked("agt_a", t0 + 2, 3)).toBe(true);
    expect(tracker.eligible("agt_a", t0 + 3)).toBe(false);
    expect(tracker.eligible("agt_a", t0 + 3 + DISPATCH_BACKOFF_MS)).toBe(true);
  });

  it("空闲轮清零计数:挡→闲→挡→挡 不触发 rounds=3 的退避", () => {
    const tracker = new BackoffTracker();
    expect(tracker.recordBlocked("agt_a", t0, 3)).toBe(false);
    tracker.recordIdle("agt_a");
    expect(tracker.recordBlocked("agt_a", t0 + 1, 3)).toBe(false);
    expect(tracker.recordBlocked("agt_a", t0 + 2, 3)).toBe(false);
    expect(tracker.eligible("agt_a", t0 + 3)).toBe(true);
  });

  it("各 Agent 计数独立", () => {
    const tracker = new BackoffTracker();
    expect(tracker.recordBlocked("agt_a", t0, 1)).toBe(true);
    expect(tracker.eligible("agt_b", t0 + 1)).toBe(true);
  });
});

describe("probeWorktreeDirty 脏工作区探测", () => {
  it("git 仓库有未提交改动 → 脏", async () => {
    const dir = newDir();
    await exec("git", ["-C", dir, "init"]);
    writeFileSync(join(dir, "dirty.txt"), "x");
    expect(await probeWorktreeDirty(dir, 10_000)).toBe(true);
  });

  it("干净仓库 → 不脏", async () => {
    const dir = newDir();
    await exec("git", ["-C", dir, "init"]);
    expect(await probeWorktreeDirty(dir, 10_000)).toBe(false);
  });

  it("非 git 目录 → unknown,不抛错", async () => {
    expect(await probeWorktreeDirty(newDir(), 10_000)).toBe("unknown");
  });
});

describe("reportHoldToConsole 挂起原因上报", () => {
  it("POST reason 到 /api/work/hold,Bearer 头就位", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await reportHoldToConsole("http://console", "agt_a.sec", "dirty_worktree", 5_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://console/api/work/hold");
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer agt_a.sec");
      expect(JSON.parse(init!.body as string)).toEqual({ reason: "dirty_worktree" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("非 2xx 抛错", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    try {
      await expect(
        reportHoldToConsole("http://console", "agt_a.sec", "dirty_worktree", 5_000),
      ).rejects.toThrow("HTTP 500");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
