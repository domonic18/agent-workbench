import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
  backfillAgentSecrets,
  loadConfigSyncState,
  MCP_SERVER_NAME,
  saveConfigSyncState,
} from "./config-sync.js";
import { createLogger, type Logger } from "./log.js";

/** 六步协议提示词:与旧调度脚本原文一致,变更需同步 docs/arch/04 */
export const DISPATCH_PROMPT = `这是一次由执行面调度器发起的协作唤醒:你的 a2a 收件箱存在未处理消息。这不是群通知,群回复纪律(NOREPLY 抑制)不适用于本次会话;在没有完成下列步骤之前,禁止直接结束回合。
按序完成:
1) 调 a2a_inbox 拉取完整消息,记下 msg_id 与 thread_id;
2) request/escalate:先 task_create 建「你自己名下」的下游任务,再 a2a_ack(msg_id=收到的消息, task_id=你的任务);reply:阅读并 a2a_ack 确认;notify:阅读并 a2a_ack;
3) 执行消息要求的本职工作(读文件、查代码、写结论);
4) a2a_send 回执:task_id 用你自己的任务,必须带 thread_id 回原线程,intent=reply,reply_to=收到的 msg_id,结论写进 summary,deadline 必填;
5) task_update 按合法路径推进状态直至关单(pending→running→done,不允许跳级)。
过程与结论只写进回执与任务字段。全部步骤完成后,最终回复用一句话概述处理结果(消息条数与任务 id)。`;

/** 会话可用工具:读文件、查代码、跑命令,以及控制台 MCP(拉收件箱、建任务、回执) */
export const ALLOWED_TOOLS = ["Read", "Grep", "Glob", "Bash", `mcp__${MCP_SERVER_NAME}`].join(",");

export interface SessionOptions {
  agentId: string;
  cwd: string;
  claudePath: string;
  model: string | null;
  timeoutMs: number;
  onExit: (result: { code: number | null; signal: NodeJS.Signals | null }) => void;
}

/** 会话句柄:停机时终止在跑会话 */
export interface SessionHandle {
  kill(signal?: NodeJS.Signals): void;
}

export interface DispatchDeps {
  /** 控制台根地址,用于探视 Agent 收件箱 */
  baseUrl: string;
  stateDir: string;
  claudeJsonPath: string;
  /** 会话超时;超时先 SIGTERM,再 SIGKILL */
  sessionTimeoutMs: number;
  model: string | null;
  /** claude 可执行文件;解析不到时调度不挂载 */
  claudePath: string | undefined;
  logger?: Logger;
  /** 探视收件箱待处理条数;默认走真实 HTTP */
  peekInbox?: (bearer: string) => Promise<number>;
  /** 起 headless 会话;默认 spawn claude CLI */
  spawnSession?: (options: SessionOptions) => SessionHandle;
}

export interface DispatchCycle {
  once(): Promise<void>;
  stop(): void;
}

/** claude 候选目录:launchd 环境 PATH 极简,需按固定候选顺序兜底 */
const CLAUDE_CANDIDATES = ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", "~/.local/bin/claude"];

/**
 * 解析 claude 可执行文件:显式 env → 当前 PATH → 常见安装目录。
 * 解析不到返回 undefined(调度不挂载,采集不受影响)。
 */
export function resolveClaudePath(envHint: string | null, pathEnv?: string): string | undefined {
  if (envHint !== null) {
    return existsSync(envHint) ? envHint : undefined;
  }
  const entries = (pathEnv ?? process.env.PATH ?? "").split(delimiter).filter((item) => item !== "");
  for (const dir of [...entries, ...CLAUDE_CANDIDATES.map((item) => item.replace(/^~(?=\/)/, homedir()))]) {
    const candidate = join(dir, "claude");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** 子进程 PATH:注入 claude 与 node 所在目录,否则 shebang 解析 ENOENT */
function childPath(claudePath: string): string {
  return [
    dirname(claudePath),
    dirname(process.execPath),
    process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  ].join(delimiter);
}

/** 探视收件箱待处理条数:只看不领,不占用消息租约 */
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

/** 默认会话实现:spawn claude CLI,超时先 SIGTERM 再 SIGKILL */
function spawnClaudeSession(options: SessionOptions): SessionHandle {
  const child = spawn(
    options.claudePath,
    [
      "-p",
      DISPATCH_PROMPT,
      ...(options.model === null ? [] : ["--model", options.model]),
      "--allowedTools",
      ALLOWED_TOOLS,
    ],
    {
      cwd: options.cwd,
      env: { ...process.env, PATH: childPath(options.claudePath) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = (stdout + chunk.toString("utf8")).slice(-2_000);
  });
  // stderr 继承到 aw-node 日志,便于排障会话启动失败
  child.stderr?.pipe(process.stderr);

  let killed = false;
  let finished = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
  }, options.timeoutMs);
  timer.unref();

  const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (finished) {
      return;
    }
    finished = true;
    clearTimeout(timer);
    options.onExit({ code, signal: killed ? "SIGTERM" : signal });
    const summary = stdout.trim().split("\n").at(-1) ?? "";
    if (summary !== "") {
      process.stderr.write(`[${options.agentId}] ${summary.slice(0, 200)}\n`);
    }
  };

  child.on("error", (error) => {
    process.stderr.write(`[${options.agentId}] 会话启动失败: ${error.message}\n`);
    finish(null, null);
  });
  child.on("close", (code, signal) => finish(code, signal));

  return { kill: (signal?: NodeJS.Signals) => child.kill(signal) };
}

export function createDispatchCycle(deps: DispatchDeps): DispatchCycle {
  const logger = deps.logger ?? createLogger();
  const peek = deps.peekInbox ?? ((bearer: string) => fetchPendingCount(deps.baseUrl, bearer, 30_000));
  const startSession = deps.spawnSession ?? spawnClaudeSession;
  /** 同一 Agent 同时只允许一个会话 */
  const busy = new Set<string>();
  const running = new Map<string, SessionHandle>();

  async function checkAgent(agentId: string, cwd: string, bearer: string): Promise<void> {
    if (busy.has(agentId)) {
      return;
    }
    const pending = await peek(bearer);
    if (pending === 0) {
      return;
    }
    if (!existsSync(cwd)) {
      logger.warn("Agent 工作目录不存在,跳过调度", { agent: agentId });
      return;
    }
    busy.add(agentId);
    logger.info("收件箱有待处理消息,起会话", { agent: agentId, pending });
    const session: SessionOptions = {
      agentId,
      cwd,
      claudePath: deps.claudePath ?? "claude",
      model: deps.model,
      timeoutMs: deps.sessionTimeoutMs,
      onExit: (result) => {
        busy.delete(agentId);
        running.delete(agentId);
        logger.info("会话结束", { agent: agentId, code: result.code, signal: result.signal });
      },
    };
    try {
      running.set(agentId, startSession(session));
    } catch (error) {
      busy.delete(agentId);
      const message = error instanceof Error ? error.message : String(error);
      logger.error("会话启动失败", { agent: agentId, error: message });
    }
  }

  async function once(): Promise<void> {
    try {
      const state = loadConfigSyncState(deps.stateDir);
      if (backfillAgentSecrets(state, deps.claudeJsonPath, logger) > 0) {
        saveConfigSyncState(deps.stateDir, state);
      }
      for (const [agentId, agent] of Object.entries(state.agents)) {
        if (agent.secret === undefined) {
          continue;
        }
        try {
          await checkAgent(agentId, agent.cwd, `${agentId}.${agent.secret}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("调度检查失败", { agent: agentId, error: message });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("调度轮次异常,下轮重试", { error: message });
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
