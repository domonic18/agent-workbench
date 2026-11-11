import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfigSyncState, MCP_SERVER_NAME, saveConfigSyncState } from "./config-sync.js";
import { createDispatchCycle, createRunEndReporter, PeekError, type RunEndReport } from "./dispatch.js";
import { DispatchStatusTracker } from "./dispatch-status.js";
import type { ConsoleClient, RunEndRequest } from "./http.js";
import {
  ALLOWED_TOOLS,
  DISPATCH_PROMPT,
  workDispatchPrompt,
} from "./dispatch-prompts.js";
import { resolveClaudePath, type SessionOptions } from "./dispatch-session.js";
import { createLogger } from "./log.js";
import { claudeProjectDir } from "./session-activity.js";

const dirs: string[] = [];

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-dispatch-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface Harness {
  stateDir: string;
  claudeJsonPath: string;
  sessions: SessionOptions[];
  killed: string[];
  pending: Map<string, number>;
  workPending: Map<string, number>;
  peeked: string[];
  workPeeked: string[];
  /** 默认实时扫描:p → 测试目录;单项测试可换新 Map 覆盖 */
  scanCwds: () => Map<string, string>;
}

function harness(options: { cwd?: string; secret?: string | undefined } = {}): Harness {
  const stateDir = newDir();
  const claudeJsonPath = join(stateDir, "claude.json");
  const cwd = options.cwd ?? stateDir;
  writeFileSync(claudeJsonPath, "{}");
  saveConfigSyncState(stateDir, {
    agents: {
      agt_a: {
        version: 1,
        project: "p",
        key: "k",
        cwd,
        ...(options.secret === undefined ? {} : { secret: options.secret }),
      },
    },
    lastSyncAt: null,
  });
  return {
    stateDir,
    claudeJsonPath,
    sessions: [],
    killed: [],
    pending: new Map(),
    workPending: new Map(),
    peeked: [],
    workPeeked: [],
    scanCwds: () => new Map([["p", cwd]]),
  };
}

function cycleFor(
  h: Harness,
  overrides: Partial<Parameters<typeof createDispatchCycle>[0]> = {},
): ReturnType<typeof createDispatchCycle> {
  return createDispatchCycle({
    baseUrl: "http://127.0.0.1:8787",
    stateDir: h.stateDir,
    claudeJsonPath: h.claudeJsonPath,
    claudeDir: h.stateDir,
    sessionTimeoutMs: 60_000,
    requestTimeoutMs: 30_000,
    model: null,
    claudePath: "/opt/homebrew/bin/claude",
    busySessionWindowMs: 15 * 60_000,
    maxMachineSessions: 2,
    dispatchBackoffRounds: 5,
    batchMaxItems: 8,
    scanCwds: h.scanCwds,
    logger: createLogger({ level: "error" }),
    async peekInbox(bearer) {
      h.peeked.push(bearer);
      return h.pending.get(bearer) ?? 0;
    },
    async peekWorkInbox(bearer) {
      h.workPeeked.push(bearer);
      return h.workPending.get(bearer) ?? 0;
    },
    spawnSession(session) {
      h.sessions.push(session);
      return {
        kill(signal) {
          h.killed.push(`${session.agentId}:${signal ?? "SIGTERM"}`);
        },
      };
    },
    ...overrides,
  });
}

describe("resolveClaudePath", () => {
  it("显式路径存在时直接采用", () => {
    const dir = newDir();
    const fake = join(dir, "claude");
    writeFileSync(fake, "#!/bin/sh\n");
    expect(resolveClaudePath(fake)).toBe(fake);
  });

  it("显式路径不存在时返回 undefined,不静默换路径", () => {
    expect(resolveClaudePath("/no/such/claude")).toBeUndefined();
  });

  it("PATH 命中优先于候选目录", () => {
    const dir = newDir();
    const fake = join(dir, "claude");
    writeFileSync(fake, "#!/bin/sh\n");
    expect(resolveClaudePath(null, dir)).toBe(fake);
  });

  it("PATH 没有时按候选目录兜底(launchd 环境 PATH 极简)", () => {
    const dir = newDir();
    const fake = join(dir, "claude");
    writeFileSync(fake, "#!/bin/sh\n");
    expect(resolveClaudePath(null, "/no/such/dir", [dir])).toBe(fake);
  });

  it("找不到时返回 undefined", () => {
    expect(resolveClaudePath(null, "/no/such/dir", ["/no/such/dir"])).toBeUndefined();
  });
});

describe("dispatch 调度循环", () => {
  it("收件箱为空不起会话", async () => {
    const h = harness({ secret: "sec-a" });
    const cycle = cycleFor(h);
    await cycle.once();
    expect(h.sessions).toHaveLength(0);
  });

  it("有消息时起会话,工作目录与提示词就位", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 2);
    const cycle = cycleFor(h);
    await cycle.once();

    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0]!.cwd).toBe(h.stateDir);
    expect(h.sessions[0]!.prompt).toBe(DISPATCH_PROMPT);
    expect(h.peeked).toEqual(["agt_a.sec-a"]);
    // a2a 命中后不再探视 work(既有协作链优先,不多打一枪)
    expect(h.workPeeked).toEqual([]);
    expect(ALLOWED_TOOLS).toContain(`mcp__${MCP_SERVER_NAME}`);
    expect(DISPATCH_PROMPT).toContain("a2a_inbox");
  });

  it("work 收件箱有待领取派工时以工作提示词起会话", async () => {
    const h = harness({ secret: "sec-a" });
    h.workPending.set("agt_a.sec-a", 1);
    const cycle = cycleFor(h);
    await cycle.once();

    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0]!.prompt).toBe(workDispatchPrompt(8));
    expect(h.peeked).toEqual(["agt_a.sec-a"]);
    expect(h.workPeeked).toEqual(["agt_a.sec-a"]);
  });

  it("a2a 与 work 都有待办时优先既有 a2a 链", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    h.workPending.set("agt_a.sec-a", 3);
    const cycle = cycleFor(h);
    await cycle.once();

    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0]!.prompt).toBe(DISPATCH_PROMPT);
  });

  it("工作提示词覆盖六条批次纪律,单批上限注入数值", () => {
    const prompt = workDispatchPrompt(8);
    for (const token of [
      "work_inbox",
      "work_read",
      "task_create",
      "work_ack",
      "fix: #<N>",
      "gh pr create",
      "Fixes #<N>",
      "task_update",
      "work_handback",
      "git status --porcelain",
      "工作区被占用",
      "留在收件箱等下一批",
      "不因一件卡整批",
      "最多 8 件",
    ]) {
      expect(prompt).toContain(token);
    }
    // 上限来自配置注入,不是写死文案
    expect(workDispatchPrompt(3)).toContain("最多 3 件");
    expect(workDispatchPrompt(3)).not.toContain("最多 8 件");
  });

  it("a2a 探视失败时不吞掉 work 探视失败,单 Agent 失败仍隔离", async () => {
    const h = harness({ secret: "sec-a" });
    const cycle = cycleFor(h, {
      async peekInbox() {
        throw new Error("HTTP 500");
      },
    });
    await expect(cycle.once()).resolves.toBeUndefined();
    // a2a 抛错即短路,work 探视不执行,会话不起
    expect(h.workPeeked).toEqual([]);
    expect(h.sessions).toHaveLength(0);
  });

  it("busy 防重:会话未结束时不再起第二个", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    const cycle = cycleFor(h);
    await cycle.once();
    await cycle.once();
    expect(h.sessions).toHaveLength(1);
  });

  it("会话退出后清 busy,下一轮可再起", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    const cycle = cycleFor(h);
    await cycle.once();
    h.sessions[0]!.onExit({ code: 0, signal: null });
    await cycle.once();
    expect(h.sessions).toHaveLength(2);
  });

  it("会话退出即上报 run-end 宣告,携带项目与预生成会话 id", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    const reports: RunEndReport[] = [];
    const cycle = cycleFor(h, {
      async reportRunEnd(report) {
        reports.push(report);
      },
    });
    await cycle.once();
    h.sessions[0]!.onExit({ code: 1, signal: "SIGTERM" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(reports).toEqual([
      {
        agentProject: "p",
        sessionId: h.sessions[0]!.sessionId,
        exitCode: 1,
        signal: "SIGTERM",
      },
    ]);
  });

  it("退出宣告抛错不影响 busy 释放,下一轮照常起会话", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    let calls = 0;
    const cycle = cycleFor(h, {
      async reportRunEnd() {
        calls += 1;
        throw new Error("控制台不可达");
      },
    });
    await cycle.once();
    h.sessions[0]!.onExit({ code: 0, signal: null });
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);

    await cycle.once();
    expect(h.sessions).toHaveLength(2);
  });

  it("起会话先登记归因再 spawn,会话 id 为合法 uuid 且每次不同", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    const order: string[] = [];
    const cycle = cycleFor(h, {
      attributeSession(sessionId, project) {
        order.push(`attr:${sessionId}:${project}`);
      },
      spawnSession(session) {
        order.push(`spawn:${session.sessionId}`);
        h.sessions.push(session);
        return {
          kill(signal) {
            h.killed.push(`${session.agentId}:${signal ?? "SIGTERM"}`);
          },
        };
      },
    });
    await cycle.once();
    h.sessions[0]!.onExit({ code: 0, signal: null });
    await cycle.once();

    expect(h.sessions).toHaveLength(2);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(h.sessions[0]!.sessionId).toMatch(uuid);
    expect(h.sessions[1]!.sessionId).toMatch(uuid);
    expect(h.sessions[0]!.sessionId).not.toBe(h.sessions[1]!.sessionId);
    expect(order[0]).toBe(`attr:${h.sessions[0]!.sessionId}:p`);
    expect(order[1]).toBe(`spawn:${h.sessions[0]!.sessionId}`);
    expect(order[2]).toBe(`attr:${h.sessions[1]!.sessionId}:p`);
    expect(order[3]).toBe(`spawn:${h.sessions[1]!.sessionId}`);
  });

  it("无密钥的 Agent 跳过,不发起探视", async () => {
    const h = harness({ secret: undefined });
    h.pending.set("agt_a.sec-a", 1);
    const cycle = cycleFor(h);
    await cycle.once();
    expect(h.peeked).toEqual([]);
    expect(h.sessions).toHaveLength(0);
  });

  it("工作目录不存在时不起会话", async () => {
    const h = harness({ secret: "sec-a", cwd: "/no/such/dir" });
    h.pending.set("agt_a.sec-a", 1);
    const cycle = cycleFor(h);
    await cycle.once();
    expect(h.sessions).toHaveLength(0);
  });

  it("从 claude.json 回填密钥后可调度", async () => {
    const h = harness({ secret: undefined });
    writeFileSync(
      h.claudeJsonPath,
      JSON.stringify({
        projects: {
          [h.stateDir]: {
            mcpServers: {
              [MCP_SERVER_NAME]: { headers: { authorization: "Bearer agt_a.sec-a" } },
            },
          },
        },
      }),
    );
    h.pending.set("agt_a.sec-a", 1);
    const cycle = cycleFor(h);
    await cycle.once();

    expect(h.sessions).toHaveLength(1);
    expect(loadConfigSyncState(h.stateDir).agents.agt_a?.secret).toBe("sec-a");
  });

  it("停机时终止在跑会话", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    const cycle = cycleFor(h);
    await cycle.once();
    cycle.stop();
    expect(h.killed).toEqual(["agt_a:SIGTERM"]);
  });

  it("单个 Agent 探视失败不影响其他 Agent", async () => {
    const h = harness({ secret: "sec-a" });
    const cycle = cycleFor(h, {
      async peekInbox() {
        throw new Error("HTTP 500");
      },
    });
    await expect(cycle.once()).resolves.toBeUndefined();
    expect(h.sessions).toHaveLength(0);
  });

  it("并发 once 不会为同一 Agent 起两个会话", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    let release = () => {};
    const cycle = cycleFor(h, {
      async peekInbox(bearer) {
        h.peeked.push(bearer);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return h.pending.get(bearer) ?? 0;
      },
    });

    const p1 = cycle.once();
    const p2 = cycle.once();
    expect(h.sessions).toHaveLength(0);
    release();
    await Promise.all([p1, p2]);

    expect(h.sessions).toHaveLength(1);
  });

  it("探视失败释放占位,下轮可再试", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    let calls = 0;
    const cycle = cycleFor(h, {
      async peekInbox(bearer) {
        calls += 1;
        if (calls === 1) {
          throw new Error("HTTP 500");
        }
        return h.pending.get(bearer) ?? 0;
      },
    });

    await cycle.once();
    await cycle.once();

    expect(h.sessions).toHaveLength(1);
  });
});

describe("派发闸门 G2/G3/G4 与退避", () => {
  const UUID = "00000000-0000-0000-0000-000000000000";

  function sampleWith(cwds: string[]): Map<string, number> {
    return new Map(cwds.map((cwd) => [`${claudeProjectDir(cwd)}/${UUID}.jsonl`, Date.now()]));
  }

  it("G2:cwd 会话活跃挡下,工作派发上报挂起原因", async () => {
    const h = harness({ secret: "sec-a" });
    h.workPending.set("agt_a.sec-a", 1);
    const holds: string[] = [];
    const cycle = cycleFor(h, {
      sampleSessions: () => sampleWith([h.stateDir]),
      async reportHold(_baseUrl, _bearer, reason) {
        holds.push(reason);
      },
    });
    await cycle.once();
    expect(h.sessions).toHaveLength(0);
    expect(holds).toEqual(["cwd_session_active"]);
  });

  it("G3:脏工作区挡下并上报 dirty_worktree", async () => {
    const h = harness({ secret: "sec-a" });
    h.workPending.set("agt_a.sec-a", 1);
    const holds: string[] = [];
    const cycle = cycleFor(h, {
      async probeDirty() {
        return true;
      },
      async reportHold(_baseUrl, _bearer, reason) {
        holds.push(reason);
      },
    });
    await cycle.once();
    expect(h.sessions).toHaveLength(0);
    expect(holds).toEqual(["dirty_worktree"]);
  });

  it("a2a 派发被闸门挡下时不上报挂起原因", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    const holds: string[] = [];
    const cycle = cycleFor(h, {
      async probeDirty() {
        return true;
      },
      async reportHold(_baseUrl, _bearer, reason) {
        holds.push(reason);
      },
    });
    await cycle.once();
    expect(h.sessions).toHaveLength(0);
    expect(holds).toEqual([]);
  });

  it("G4:机级活跃会话达到上限挡下(其他目录占满),不写挂起原因", async () => {
    const h = harness({ secret: "sec-a" });
    h.workPending.set("agt_a.sec-a", 1);
    const holds: string[] = [];
    const cycle = cycleFor(h, {
      sampleSessions: () => sampleWith(["/other/one", "/other/two"]),
      async reportHold(_baseUrl, _bearer, reason) {
        holds.push(reason);
      },
    });
    await cycle.once();
    expect(h.sessions).toHaveLength(0);
    expect(holds).toEqual([]);
  });

  it("闸门挡下 ≠ 取消:条件消失后下一轮照常派发", async () => {
    const h = harness({ secret: "sec-a" });
    h.workPending.set("agt_a.sec-a", 1);
    let dirty = true;
    const cycle = cycleFor(h, {
      async probeDirty() {
        return dirty;
      },
    });
    await cycle.once();
    expect(h.sessions).toHaveLength(0);
    dirty = false;
    await cycle.once();
    expect(h.sessions).toHaveLength(1);
  });

  it("退避:连续被挡达到阈值后跳过探视", async () => {
    const h = harness({ secret: "sec-a" });
    h.workPending.set("agt_a.sec-a", 1);
    const cycle = cycleFor(h, {
      async probeDirty() {
        return true;
      },
      dispatchBackoffRounds: 2,
    });
    await cycle.once();
    await cycle.once();
    const peekedAtBackoff = h.workPeeked.length;
    await cycle.once();
    expect(h.workPeeked.length).toBe(peekedAtBackoff);
    expect(h.sessions).toHaveLength(0);
  });

  it("空闲轮清零退避计数,不会误触发", async () => {
    const h = harness({ secret: "sec-a" });
    let dirty = true;
    const cycle = cycleFor(h, {
      async probeDirty() {
        return dirty;
      },
      dispatchBackoffRounds: 2,
    });
    // 挡一轮 → 空闲一轮(清零)→ 再挡一轮:计数未连续,仍可探视
    h.workPending.set("agt_a.sec-a", 1);
    await cycle.once();
    h.workPending.clear();
    dirty = false;
    await cycle.once();
    h.workPending.set("agt_a.sec-a", 1);
    dirty = true;
    await cycle.once();
    const peeked = h.workPeeked.length;
    await cycle.once();
    expect(h.workPeeked.length).toBeGreaterThan(peeked);
  });
});

describe("cwd 实时解析与派发状态(M3.11)", () => {
  function statusFor(): { status: DispatchStatusTracker; attach: Record<string, unknown> } {
    const status = new DispatchStatusTracker(() => 1_700_000_000_000);
    return { status, attach: { status } };
  }

  it("cwd 取实时扫描而非下发快照:目录挪动下一轮即跟随", async () => {
    const stale = newDir();
    const fresh = newDir();
    const h = harness({ secret: "sec-a", cwd: stale });
    h.pending.set("agt_a.sec-a", 1);
    const cycle = cycleFor(h, {
      scanCwds: () => new Map([["p", fresh]]),
    });
    await cycle.once();
    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0]!.cwd).toBe(fresh);
  });

  it("项目不在实时扫描 → cwd_unknown 挂起,不起会话不探视", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    const { status, attach } = statusFor();
    const cycle = cycleFor(h, {
      scanCwds: () => new Map(),
      ...attach,
    });
    await cycle.once();
    expect(h.peeked).toEqual([]);
    expect(h.sessions).toHaveLength(0);
    expect(status.snapshot()).toEqual([
      { project: "p", pending: 0, hold: "cwd_unknown", since_ts: 1_700_000_000_000 },
    ]);
  });

  it("目录不存在 → cwd_missing 挂起并携带待办数", async () => {
    const h = harness({ secret: "sec-a", cwd: "/no/such/dir" });
    h.pending.set("agt_a.sec-a", 2);
    const { status, attach } = statusFor();
    const cycle = cycleFor(h, { ...attach });
    await cycle.once();
    expect(h.sessions).toHaveLength(0);
    expect(status.snapshot()).toEqual([
      { project: "p", pending: 2, hold: "cwd_missing", since_ts: 1_700_000_000_000 },
    ]);
  });

  it("闸门挡下记入状态快照,a2a 路径同样可见", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    const { status, attach } = statusFor();
    const cycle = cycleFor(h, {
      async probeDirty() {
        return true;
      },
      ...attach,
    });
    await cycle.once();
    expect(status.snapshot()).toEqual([
      { project: "p", pending: 1, hold: "dirty_worktree", since_ts: 1_700_000_000_000 },
    ]);
  });

  it("挂起解除即清除:目录恢复且收件箱清空后快照为空", async () => {
    const h = harness({ secret: "sec-a", cwd: "/no/such/dir" });
    h.pending.set("agt_a.sec-a", 1);
    const { status, attach } = statusFor();
    const cycle = cycleFor(h, {
      scanCwds: () => new Map([["p", "/no/such/dir"]]),
      ...attach,
    });
    await cycle.once();
    expect(status.snapshot()).toHaveLength(1);
    // 目录恢复 + 待办清空 → 空闲清除
    h.scanCwds = () => new Map([["p", h.stateDir]]);
    h.pending.clear();
    const healed = cycleFor(h, { scanCwds: () => new Map([["p", h.stateDir]]), ...attach });
    await healed.once();
    expect(status.snapshot()).toEqual([]);
  });

  it("连续 3 轮探视 401 → auth_stale;探视成功后清除", async () => {
    const h = harness({ secret: "sec-a" });
    const { status, attach } = statusFor();
    let fail = true;
    const cycle = cycleFor(h, {
      ...attach,
      async peekInbox(bearer) {
        h.peeked.push(bearer);
        if (fail) {
          throw new PeekError(401);
        }
        return h.pending.get(bearer) ?? 0;
      },
    });
    await cycle.once();
    expect(status.snapshot()).toEqual([]);
    await cycle.once();
    expect(status.snapshot()).toEqual([]);
    await cycle.once();
    expect(status.snapshot()).toEqual([
      { project: "p", pending: 0, hold: "auth_stale", since_ts: 1_700_000_000_000 },
    ]);
    fail = false;
    await cycle.once();
    expect(status.snapshot()).toEqual([]);
  });

  it("非 401 探视失败不计 auth_stale 连击", async () => {
    const h = harness({ secret: "sec-a" });
    const { status, attach } = statusFor();
    const cycle = cycleFor(h, {
      ...attach,
      async peekInbox() {
        throw new PeekError(500);
      },
    });
    for (let i = 0; i < 5; i += 1) {
      await cycle.once();
    }
    expect(status.snapshot()).toEqual([]);
  });

  it("401 与其他错误交替不足以触发:连击只被探视成功清零,非 401 不累计也不打断", async () => {
    const h = harness({ secret: "sec-a" });
    const { status, attach } = statusFor();
    let n = 0;
    const cycle = cycleFor(h, {
      ...attach,
      async peekInbox() {
        n += 1;
        throw n % 2 === 1 ? new PeekError(401) : new PeekError(502);
      },
    });
    // 401、502 交替四轮:401 累计 2,未达阈值 3
    for (let i = 0; i < 4; i += 1) {
      await cycle.once();
    }
    expect(status.snapshot()).toEqual([]);
    // 第五轮第三个 401:触发 auth_stale
    await cycle.once();
    expect(status.snapshot()).toEqual([
      { project: "p", pending: 0, hold: "auth_stale", since_ts: 1_700_000_000_000 },
    ]);
  });

  it("spawn 同步抛错 → spawn_failed 挂起,占位释放下轮可再试", async () => {
    const h = harness({ secret: "sec-a" });
    h.pending.set("agt_a.sec-a", 1);
    const { status, attach } = statusFor();
    let fail = true;
    const cycle = cycleFor(h, {
      ...attach,
      spawnSession(session) {
        if (fail) {
          throw new Error("spawn ENOENT");
        }
        h.sessions.push(session);
        return {
          kill(signal) {
            h.killed.push(`${session.agentId}:${signal ?? "SIGTERM"}`);
          },
        };
      },
    });
    await cycle.once();
    expect(status.snapshot()).toEqual([
      { project: "p", pending: 1, hold: "spawn_failed", since_ts: 1_700_000_000_000 },
    ]);
    fail = false;
    await cycle.once();
    expect(h.sessions).toHaveLength(1);
    expect(status.snapshot()).toEqual([]);
  });
});

describe("createRunEndReporter", () => {
  function fakeClient(behavior: (attempt: number) => Promise<void>) {
    const requests: RunEndRequest[] = [];
    let attempt = 0;
    const client = {
      async postRunEnd(request: RunEndRequest) {
        requests.push(request);
        attempt += 1;
        await behavior(attempt);
        return { run_id: "run_x" };
      },
    } as unknown as ConsoleClient;
    return { client, requests };
  }

  const report: RunEndReport = {
    agentProject: "p",
    sessionId: "11111111-2222-3333-4444-555555555555",
    exitCode: 0,
    signal: null,
  };

  it("成功即上报一次,流为 claude-session:<会话 id>", async () => {
    const { client, requests } = fakeClient(async () => {});
    await createRunEndReporter({ client, now: () => 9_000, retryDelayMs: 1 })(report);
    expect(requests).toEqual([
      {
        agent_project: "p",
        stream_id: "claude-session:11111111-2222-3333-4444-555555555555",
        ended_at: 9_000,
        exit_code: 0,
        signal: null,
      },
    ]);
  });

  it("失败重试一次,二次成功不再重发", async () => {
    const { client, requests } = fakeClient(async (attempt) => {
      if (attempt === 1) {
        throw new Error("网络抖动");
      }
    });
    await createRunEndReporter({ client, now: () => 9_000, retryDelayMs: 1 })(report);
    expect(requests).toHaveLength(2);
  });

  it("两次都失败即放弃,不抛出(best-effort,交控制台 L3 兜底)", async () => {
    const { client, requests } = fakeClient(async () => {
      throw new Error("控制台不可达");
    });
    const reporter = createRunEndReporter({
      client,
      logger: createLogger({ level: "error", sink: () => {} }),
      now: () => 9_000,
      retryDelayMs: 1,
    });
    await expect(reporter(report)).resolves.toBeUndefined();
    expect(requests).toHaveLength(2);
  });
});

