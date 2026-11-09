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
import { createLogger, type Logger } from "./log.js";
import {
  resolveSessionActivity,
  sampleSessionFiles,
  type SessionActivity,
  type SessionSample,
} from "./session-activity.js";

/** 探视 a2a 收件箱待处理条数:只看不领,不占用消息租约 */
async function fetchPendingCount(baseUrl: string, bearer: string, timeoutMs: number): Promise<number> {
  const response = await fetch(`${baseUrl}/api/a2a/inbox?wait=0&peek=1`, {
    headers: { authorization: `Bearer ${bearer}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`收件箱探视失败(HTTP ${response.status})`);
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
    throw new Error(`工作收件箱探视失败(HTTP ${response.status})`);
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
    try {
      // 双探视:a2a 待办优先(既有协作链不回归),无 a2a 才看 work 派工
      const pending = await peek(bearer);
      let prompt: string | null = null;
      let isWorkDispatch = false;
      if (pending > 0) {
        prompt = DISPATCH_PROMPT;
      } else {
        const workPending = await peekWork(bearer);
        if (workPending > 0) {
          prompt = workPrompt;
          isWorkDispatch = true;
        }
      }
      if (prompt === null) {
        backoff.recordIdle(agentId);
        return;
      }
      if (!existsSync(cwd)) {
        logger.warn("Agent 工作目录不存在,跳过调度", { agent: agentId });
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
        },
      };
      running.set(agentId, startSession(session));
      sessionStarted = true;
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
      for (const [agentId, agent] of Object.entries(state.agents)) {
        if (agent.secret === undefined) {
          continue;
        }
        // 退避期内不探视;到期自动恢复,条件消失照常放行
        if (!backoff.eligible(agentId, Date.now())) {
          continue;
        }
        try {
          await checkAgent(agentId, agent.project, agent.cwd, `${agentId}.${agent.secret}`, getActivity);
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
