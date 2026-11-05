import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfigSyncState, MCP_SERVER_NAME, saveConfigSyncState } from "./config-sync.js";
import {
  ALLOWED_TOOLS,
  createDispatchCycle,
  DISPATCH_PROMPT,
  WORK_DISPATCH_PROMPT,
  resolveClaudePath,
  type SessionOptions,
} from "./dispatch.js";
import { createLogger } from "./log.js";

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
    sessionTimeoutMs: 60_000,
    requestTimeoutMs: 30_000,
    model: null,
    claudePath: "/opt/homebrew/bin/claude",
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
    expect(h.sessions[0]!.prompt).toBe(WORK_DISPATCH_PROMPT);
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

  it("工作提示词覆盖承接链与 PR 关键动作", () => {
    for (const token of [
      "work_inbox",
      "work_read",
      "task_create",
      "work_ack",
      "Fixes #",
      "gh pr create",
      "task_update",
      "work_handback",
    ]) {
      expect(WORK_DISPATCH_PROMPT).toContain(token);
    }
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
