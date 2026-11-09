import { execFile } from "node:child_process";
import { delimiter } from "node:path";
import type { WorkHoldReason } from "../../src/shared/constants.js";
import type { Logger } from "./log.js";
import type { SessionActivity } from "./session-activity.js";

/**
 * 派发前置闸门的执行面部分(M3.10,dispatch-coordination.md §3.1):
 * G2→G3→G4 闸门链(runGates)、G3 脏工作区探测、挂起原因上报、连续被挡退避。
 * 会话活跃判定取 session-activity.ts;G1 per-agent busy 在 dispatch.ts。
 */

/** 连续被挡 N 轮后的探视退避时长(退避 ≠ 放弃,条件消失照常放行) */
export const DISPATCH_BACKOFF_MS = 5 * 60_000;

/** git status 探测的可用 PATH:launchd 环境 PATH 极简,按候选目录兜底 */
const GIT_CANDIDATE_DIRS = ["/usr/bin", "/opt/homebrew/bin", "/usr/local/bin"];

function gitEnvPath(): string {
  const entries = (process.env.PATH ?? "").split(delimiter).filter((item) => item !== "");
  return [...GIT_CANDIDATE_DIRS, ...entries].join(delimiter);
}

/**
 * G3 脏工作区探测:输出非空 → 脏;git 不可用或非 git 目录 → "unknown"
 * (调用方记 WARN 放行,不因探测失败瘫痪派发,dispatch-coordination §3.1.2)。
 */
export async function probeWorktreeDirty(
  cwd: string,
  timeoutMs: number,
): Promise<boolean | "unknown"> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "status", "--porcelain"],
      { timeout: Math.min(timeoutMs, 10_000), env: { ...process.env, PATH: gitEnvPath() } },
      (error, stdout) => {
        if (error !== null) {
          resolve("unknown");
          return;
        }
        resolve(stdout.trim() !== "");
      },
    );
  });
}

/** 挂起原因上报:写 pending 行的 reason 列(控制台幂等承接,首次挂起群播报) */
export async function reportHoldToConsole(
  baseUrl: string,
  bearer: string,
  reason: WorkHoldReason,
  timeoutMs: number,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/work/hold`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({ reason }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`挂起原因上报失败(HTTP ${response.status})`);
  }
}

/**
 * 连续被挡退避(§3.1.4):同一 Agent 连续 rounds 轮被闸门挡 → 探视退避 5min。
 * 空闲轮(无待派发)不计数并清零;放行后重新累计。
 */
export class BackoffTracker {
  private streak = new Map<string, number>();
  private nextEligibleAt = new Map<string, number>();

  /** 本轮是否允许探视该 Agent(退避期内返回 false) */
  eligible(agentId: string, now: number): boolean {
    return (this.nextEligibleAt.get(agentId) ?? 0) <= now;
  }

  /** 本轮被闸门挡:连续计数 +1,达 rounds 触发退避并清零计数 */
  recordBlocked(agentId: string, now: number, rounds: number): boolean {
    const streak = (this.streak.get(agentId) ?? 0) + 1;
    if (streak >= rounds) {
      this.streak.set(agentId, 0);
      this.nextEligibleAt.set(agentId, now + DISPATCH_BACKOFF_MS);
      return true;
    }
    this.streak.set(agentId, streak);
    return false;
  }

  /** 空闲或成功放行:连续计数清零(退避时刻不受影响) */
  recordIdle(agentId: string): void {
    this.streak.set(agentId, 0);
  }
}

/** 闸门链依赖:探测与上报均可注入,便于测试与不同环境 */
export interface GateDeps {
  activity: SessionActivity;
  probeDirty: (cwd: string, timeoutMs: number) => Promise<boolean | "unknown">;
  /** 挂起原因上报(已绑定 Agent Bearer);仅工作派发路径调用 */
  reportHold: (reason: WorkHoldReason) => Promise<void>;
  maxMachineSessions: number;
  requestTimeoutMs: number;
  logger: Logger;
}

export interface GateInput {
  agentId: string;
  cwd: string;
  /** 工作派发才上报挂起原因:a2a 收件箱没有可写 reason 的 pending 行 */
  isWorkDispatch: boolean;
}

/** pass=放行;其余为挡下原因(G4 软闸门不写 reason 行) */
export type GateOutcome = "pass" | WorkHoldReason | "machine_limit";

async function reportHoldQuiet(
  deps: GateDeps,
  input: GateInput,
  reason: WorkHoldReason,
): Promise<void> {
  if (!input.isWorkDispatch) {
    return;
  }
  try {
    await deps.reportHold(reason);
  } catch (error) {
    // 上报失败不改变闸门判定本身,下一轮仍被挡会再报
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn("挂起原因上报失败", { agent: input.agentId, reason, error: message });
  }
}

/**
 * G2→G3→G4 闸门链:cwd 会话活跃(硬)、脏工作区(硬,探测失败 WARN 放行)、
 * 机级活跃会话上限(软,不写挂起原因)。任一挡下即返回挡下原因,全过返回 "pass"。
 */
export async function runGates(deps: GateDeps, input: GateInput): Promise<GateOutcome> {
  if (deps.activity.cwdActive(input.cwd)) {
    await reportHoldQuiet(deps, input, "cwd_session_active");
    return "cwd_session_active";
  }
  const dirty = await deps.probeDirty(input.cwd, deps.requestTimeoutMs);
  if (dirty === true) {
    await reportHoldQuiet(deps, input, "dirty_worktree");
    return "dirty_worktree";
  }
  if (dirty === "unknown") {
    deps.logger.warn("脏工作区探测失败,本轮放行", { agent: input.agentId, cwd: input.cwd });
  }
  if (deps.activity.activeCount >= deps.maxMachineSessions) {
    return "machine_limit";
  }
  return "pass";
}
