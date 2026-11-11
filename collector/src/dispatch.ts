import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { WorkHoldReason } from "../../src/shared/constants.js";
import {
  backfillAgentSecrets,
  loadConfigSyncState,
  saveConfigSyncState,
} from "./config-sync.js";
import {
  BackoffTracker,
  probeWorktreeDirty,
  reportHoldToConsole,
  runGates,
  type GateDeps,
} from "./dispatch-gates.js";
import { DISPATCH_PROMPT, workDispatchPrompt } from "./dispatch-prompts.js";
import {
  spawnClaudeSession,
  type SessionHandle,
  type SessionOptions,
} from "./dispatch-session.js";
import { DispatchStatusTracker } from "./dispatch-status.js";
import { scanCwdByProject } from "./discovery.js";
import type { ConsoleClient, RunEndRequest } from "./http.js";
import { createLogger, type Logger } from "./log.js";
import {
  resolveSessionActivity,
  sampleSessionFiles,
  type SessionActivity,
  type SessionSample,
} from "./session-activity.js";
import { streamIdFor } from "./state.js";

/** 收件箱探视的 HTTP 失败:携带状态码,连续 401 用于判密钥过期(auth_stale) */
export class PeekError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`收件箱探视失败(HTTP ${status})`);
    this.name = "PeekError";
    this.status = status;
  }
}

/** 探视 a2a 收件箱待处理条数:只看不领,不占用消息租约 */
async function fetchPendingCount(baseUrl: string, bearer: string, timeoutMs: number): Promise<number> {
  const response = await fetch(`${baseUrl}/api/a2a/inbox?wait=0&peek=1`, {
    headers: { authorization: `Bearer ${bearer}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new PeekError(response.status);
  }
  const body = (await response.json()) as { items?: unknown[] };
  return Array.isArray(body.items) ? body.items.length : 0;
}

/** 探视 work 收件箱待领取派工条数:只看不领,不占行租约 */
async function fetchWorkPendingCount(
  baseUrl: string,
  bearer: string,
  timeoutMs: number,
): Promise<number> {
  const response = await fetch(`${baseUrl}/api/work/inbox?wait=0&peek=1`, {
    headers: { authorization: `Bearer ${bearer}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new PeekError(response.status);
  }
  const body = (await response.json()) as { items?: unknown[] };
  return Array.isArray(body.items) ? body.items.length : 0;
}

export interface DispatchDeps {
  /** 控制台根地址,用于探视 Agent 收件箱与上报挂起原因 */
  baseUrl: string;
  stateDir: string;
  claudeJsonPath: string;
  /** Claude Code 配置根目录(~/.claude);G2/G4 会话活跃采样用 */
  claudeDir: string;
  /** 会话超时;超时先 SIGTERM,再 SIGKILL */
  sessionTimeoutMs: number;
  /** HTTP 请求超时(含收件箱探视);与采集共用同一配置 */
  requestTimeoutMs: number;
  model: string | null;
  /** claude 可执行文件;解析不到时调度不挂载 */
  claudePath: string | undefined;
  /** G2 cwd 活跃会话判定窗口;窗口内新出现的会话文件视为开发进行中 */
  busySessionWindowMs: number;
  /** G4 机级活跃会话上限(含交互会话);达到后本轮全机不派发 */
  maxMachineSessions: number;
  /** 连续被挡 N 轮后探视退避 5min(退避 ≠ 放弃,条件消失照常放行) */
  dispatchBackoffRounds: number;
  /** 单批派工上限;注入工作提示词,超出部分留下一批 */
  batchMaxItems: number;
  /** 每轮现算项目名 → 工作目录(M3.11):cwd 事实源是 cc-connect 配置,不读下发快照 */
  scanCwds?: () => Map<string, string>;
  /** 派发状态登记:daemon 注入与心跳共享的实例;缺省内部新建(不上报,测试隔离) */
  status?: DispatchStatusTracker;
  /** 连续多少轮探视 401 判 auth_stale;默认 3 */
  authStaleRounds?: number;
  logger?: Logger;
  /** 探视 a2a 收件箱待处理条数;默认走真实 HTTP */
  peekInbox?: (bearer: string) => Promise<number>;
  /** 探视 work 收件箱待领取派工条数;默认走真实 HTTP */
  peekWorkInbox?: (bearer: string) => Promise<number>;
  /** 起 headless 会话;默认 spawn claude CLI */
  spawnSession?: (options: SessionOptions) => SessionHandle;
  /** G3 脏工作区探测;默认 git status --porcelain */
  probeDirty?: (cwd: string, timeoutMs: number) => Promise<boolean | "unknown">;
  /** 挂起原因上报;默认 POST /api/work/hold */
  reportHold?: (
    baseUrl: string,
    bearer: string,
    reason: WorkHoldReason,
    timeoutMs: number,
  ) => Promise<void>;
  /** G2/G4 会话文件采样;默认扫 claudeDir/projects 下的会话 jsonl */
  sampleSessions?: (claudeDir: string) => SessionSample;
  /** 派发会话归因登记:daemon 注入本地注册表,采集才能把 headless 会话归到 Agent 项目 */
  attributeSession?: (sessionId: string, project: string) => void;
  /** 会话退出宣告(L1,04 §2):daemon 注入;失败重试由实现方负责,最终由控制台 L3 兜底 */
  reportRunEnd?: (report: RunEndReport) => Promise<void>;
}

/** 退出宣告入参:sessionId 是 spawn 前预生成的会话 id,流即 claude-session:<sessionId> */
export interface RunEndReport {
  agentProject: string;
  sessionId: string;
  exitCode: number | null;
  signal: string | null;
}

export interface RunEndReporterDeps {
  client: ConsoleClient;
  logger?: Logger;
  now?: () => number;
  /** 两次尝试间的等待;默认 3s,测试可缩短 */
  retryDelayMs?: number;
}

/**
 * 退出宣告默认实现(04 §2 L1):机器 Bearer 上报控制台收尾当前 run。
 * best-effort——失败等一小会儿重试一次,再失败就放弃,进程退出是事实但
 * 控制台还有 L2 观测续命与 L3 兜底收敛,信号缺失不致命。
 */
export function createRunEndReporter(deps: RunEndReporterDeps) {
  const logger = deps.logger ?? createLogger();
  const now = deps.now ?? Date.now;
  const retryDelayMs = deps.retryDelayMs ?? 3_000;
  return async function reportRunEnd(report: RunEndReport): Promise<void> {
    const request: RunEndRequest = {
      agent_project: report.agentProject,
      stream_id: streamIdFor(report.sessionId, 0),
      ended_at: now(),
      exit_code: report.exitCode,
      signal: report.signal,
    };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await deps.client.postRunEnd(request);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === 2) {
          logger.warn("run 退出宣告失败,交控制台兜底收敛", {
            sessionId: report.sessionId,
            error: message,
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  };
}

export interface DispatchCycle {
  once(): Promise<void>;
  stop(): void;
}

export function createDispatchCycle(deps: DispatchDeps): DispatchCycle {
  const logger = deps.logger ?? createLogger();
  const peek =
    deps.peekInbox ?? ((bearer: string) => fetchPendingCount(deps.baseUrl, bearer, deps.requestTimeoutMs));
  const peekWork =
    deps.peekWorkInbox ??
    ((bearer: string) => fetchWorkPendingCount(deps.baseUrl, bearer, deps.requestTimeoutMs));
  const startSession = deps.spawnSession ?? spawnClaudeSession;
  const probeDirty = deps.probeDirty ?? probeWorktreeDirty;
  const reportHold = deps.reportHold ?? reportHoldToConsole;
  const sampleSessions = deps.sampleSessions ?? sampleSessionFiles;
  const attributeSession = deps.attributeSession ?? (() => {});
  const reportRunEnd = deps.reportRunEnd;
  const scanCwds = deps.scanCwds ?? (() => scanCwdByProject());
  const status = deps.status ?? new DispatchStatusTracker();
  const authStaleRounds = deps.authStaleRounds ?? 3;
  /** 同一 Agent 连续探视 401 计数:达 authStaleRounds 判密钥过期,探视成功即清零 */
  const authFailStreak = new Map<string, number>();
  /** 连续被挡退避 + 双采样基线:轮末换基线,两轮比 mtime 前进判「仍在写入」 */
  const backoff = new BackoffTracker();
  let prevSample: SessionSample | undefined;
  /** 同一 Agent 同时只允许一个会话 */
  const busy = new Set<string>();
  const workPrompt = workDispatchPrompt(deps.batchMaxItems);
  const running = new Map<string, SessionHandle>();

  async function checkAgent(
    agentId: string,
    project: string,
    cwd: string,
    bearer: string,
    getActivity: () => SessionActivity,
  ): Promise<void> {
    if (busy.has(agentId)) {
      return;
    }
    /** 占位必须在首个 await 前完成,否则重叠轮次可能穿透 busy 检查为同一 Agent 起多个会话 */
    busy.add(agentId);
    let sessionStarted = false;
    /** 探视同时维护 401 连击:成功清零,连续 401 达阈值判 auth_stale(其他错误不计) */
    const peekCounted = async (fn: (bearer: string) => Promise<number>): Promise<number> => {
      try {
        const count = await fn(bearer);
        authFailStreak.set(agentId, 0);
        return count;
      } catch (error) {
        if (error instanceof PeekError && error.status === 401) {
          const streak = (authFailStreak.get(agentId) ?? 0) + 1;
          authFailStreak.set(agentId, streak);
          if (streak >= authStaleRounds) {
            status.recordHold(project, "auth_stale");
            logger.warn("探视连续 401,密钥疑似过期,等控制台轮换重发自愈", { agent: agentId, streak });
          }
        }
        throw error;
      }
    };
    try {
      // 双探视:a2a 待办优先(既有协作链不回归),无 a2a 才看 work 派工
      let pendingTotal = await peekCounted(peek);
      let prompt: string | null = null;
      let isWorkDispatch = false;
      if (pendingTotal > 0) {
        prompt = DISPATCH_PROMPT;
      } else {
        pendingTotal = await peekCounted(peekWork);
        if (pendingTotal > 0) {
          prompt = workPrompt;
          isWorkDispatch = true;
        }
      }
      if (prompt === null) {
        backoff.recordIdle(agentId);
        status.clear(project);
        return;
      }
      if (!existsSync(cwd)) {
        status.recordHold(project, "cwd_missing", pendingTotal);
        logger.warn("Agent 工作目录不存在,跳过调度", { agent: agentId, cwd });
        return;
      }
      // G2→G3→G4 闸门链:cwd 会话在写、脏工作区、机级上限,任一挡下本轮不派发
      const gateDeps: GateDeps = {
        activity: getActivity(),
        probeDirty,
        reportHold: (reason) => reportHold(deps.baseUrl, bearer, reason, deps.requestTimeoutMs),
        maxMachineSessions: deps.maxMachineSessions,
        requestTimeoutMs: deps.requestTimeoutMs,
        logger,
      };
      const outcome = await runGates(gateDeps, { agentId, cwd, isWorkDispatch });
      if (outcome !== "pass") {
        status.recordHold(project, outcome, pendingTotal);
        const backoffTriggered = backoff.recordBlocked(agentId, Date.now(), deps.dispatchBackoffRounds);
        logger.warn("派发闸门挡下,本轮不派发", { agent: agentId, outcome, backoffTriggered });
        return;
      }
      backoff.recordIdle(agentId);
      logger.info("收件箱有待处理消息,起会话", {
        agent: agentId,
        source: isWorkDispatch ? "work" : "a2a",
      });
      // 会话 id 先登记归因再 spawn:不给「会话已在写、归因还没接上」留窗口
      const sessionId = randomUUID();
      attributeSession(sessionId, project);
      const session: SessionOptions = {
        agentId,
        sessionId,
        cwd,
        prompt,
        claudePath: deps.claudePath ?? "claude",
        model: deps.model,
        timeoutMs: deps.sessionTimeoutMs,
        onExit: (result) => {
          busy.delete(agentId);
          running.delete(agentId);
          logger.info("会话结束", { agent: agentId, code: result.code, signal: result.signal });
          if (reportRunEnd !== undefined) {
            void reportRunEnd({
              agentProject: project,
              sessionId,
              exitCode: result.code,
              signal: result.signal,
            }).catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn("run 退出宣告异常", { agent: agentId, sessionId, error: message });
            });
          }
        },
      };
      try {
        running.set(agentId, startSession(session));
      } catch (error) {
        status.recordHold(project, "spawn_failed", pendingTotal);
        throw error;
      }
      sessionStarted = true;
      status.clear(project);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("调度检查失败", { agent: agentId, error: message });
    } finally {
      if (!sessionStarted) {
        busy.delete(agentId);
      }
    }
  }

  async function once(): Promise<void> {
    /** 本轮会话活跃判定:首个过闸门的 Agent 触发采样,同轮复用;空闲轮零 I/O */
    let currSample: SessionSample | undefined;
    let activity: SessionActivity | undefined;
    const getActivity = (): SessionActivity => {
      if (activity === undefined) {
        currSample = sampleSessions(deps.claudeDir);
        activity = resolveSessionActivity(prevSample, currSample, Date.now(), deps.busySessionWindowMs);
      }
      return activity;
    };
    try {
      const state = loadConfigSyncState(deps.stateDir);
      if (backfillAgentSecrets(state, deps.claudeJsonPath, logger) > 0) {
        saveConfigSyncState(deps.stateDir, state);
      }
      // cwd 实时解析(M3.11):每轮现算 project→cwd,目录挪动下一轮即跟随,
      // 不读下发快照里 ACK 后冻结的旧值
      const cwds = scanCwds();
      for (const [agentId, agent] of Object.entries(state.agents)) {
        if (agent.secret === undefined) {
          continue;
        }
        // 退避期内不探视;到期自动恢复,条件消失照常放行
        if (!backoff.eligible(agentId, Date.now())) {
          continue;
        }
        const cwd = cwds.get(agent.project);
        if (cwd === undefined) {
          status.recordHold(agent.project, "cwd_unknown");
          logger.warn("项目未在 cc-connect 配置中发现,跳过调度", { agent: agentId, project: agent.project });
          continue;
        }
        try {
          await checkAgent(agentId, agent.project, cwd, `${agentId}.${agent.secret}`, getActivity);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("调度检查失败", { agent: agentId, error: message });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("调度轮次异常,下轮重试", { error: message });
    } finally {
      // 轮末换基线;全轮未采样(空闲)则保留旧基线,mtime 对比仍单调
      if (currSample !== undefined) {
        prevSample = currSample;
      }
    }
  }

  function stop(): void {
    for (const [agentId, handle] of running) {
      logger.info("停机中,终止会话", { agent: agentId });
      handle.kill("SIGTERM");
    }
    running.clear();
    busy.clear();
  }

  return { once, stop };
}
