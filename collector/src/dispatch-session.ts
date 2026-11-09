import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { ALLOWED_TOOLS } from "./dispatch-prompts.js";

export interface SessionOptions {
  agentId: string;
  /** 预生成会话 id:传给 claude --session-id,并由调用方登记进本地归因,采集才能归因到项目 */
  sessionId: string;
  cwd: string;
  /** 本次会话提示词:a2a 唤醒用 DISPATCH_PROMPT,工作唤醒用 WORK_DISPATCH_PROMPT */
  prompt: string;
  claudePath: string;
  model: string | null;
  timeoutMs: number;
  onExit: (result: { code: number | null; signal: NodeJS.Signals | null }) => void;
}

/** 会话句柄:停机时终止在跑会话 */
export interface SessionHandle {
  kill(signal?: NodeJS.Signals): void;
}

/** claude 候选目录:launchd 环境 PATH 极简,需按固定候选顺序兜底 */
export const CLAUDE_CANDIDATE_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "~/.local/bin"];

/**
 * 解析 claude 可执行文件:显式 env → 当前 PATH → 常见安装目录。
 * 解析不到返回 undefined(调度不挂载,采集不受影响)。
 */
export function resolveClaudePath(
  envHint: string | null,
  pathEnv?: string,
  candidateDirs: readonly string[] = CLAUDE_CANDIDATE_DIRS,
): string | undefined {
  if (envHint !== null) {
    return existsSync(envHint) ? envHint : undefined;
  }
  const entries = (pathEnv ?? process.env.PATH ?? "").split(delimiter).filter((item) => item !== "");
  const dirs = [
    ...entries,
    ...candidateDirs.map((item) => item.replace(/^~(?=\/)/, homedir())),
  ];
  for (const dir of dirs) {
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

/** 默认会话实现:spawn claude CLI,超时先 SIGTERM 再 SIGKILL */
export function spawnClaudeSession(options: SessionOptions): SessionHandle {
  const child = spawn(
    options.claudePath,
    [
      "-p",
      options.prompt,
      "--session-id",
      options.sessionId,
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
