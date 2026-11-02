#!/usr/bin/env node
// 执行面调度器(2026-11-02 裁决):协作群不再唤醒 Agent,由本脚本确定性拉收件箱,
// 有待处理消息才起 headless 会话执行六步链路。配合 cc-connect cron --exec 每分钟调度。
// 用法: node scripts/aw-dispatch.mjs --env workspace/mcp/aw-demo.env [--cwd /path/to/repo] [--mcp-config workspace/mcp/aw-demo.mcp.json]

import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

const LOCK_STALE_MS = 30 * 60_000;
const INBOX_TIMEOUT_MS = 15_000;
const SESSION_TIMEOUT_MS = 30 * 60_000;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  const names = ["--env", "--cwd", "--mcp-config", "--claude"];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!names.includes(arg)) {
      fail(`未知参数 ${arg}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`${arg} 缺少取值`);
    }
    options[arg.slice(2)] = resolve(value);
    i += 1;
  }
  if (options.env === undefined) {
    fail("缺少 --env <enroll 生成的 .env 文件>");
  }
  return options;
}

/** 解析 enroll-agent.mjs 写出的单引号 shell env 文件 */
function parseEnvFile(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z_]+)='(.*)'$/.exec(line.trim());
    if (match === null) {
      continue;
    }
    values[match[1]] = match[2].replace(/'\\''/g, "'");
  }
  const required = ["AW_AGENT_ID", "AW_AGENT_SECRET", "CONSOLE_URL", "AW_PROJECT"];
  for (const key of required) {
    if (values[key] === undefined || values[key] === "") {
      fail(`${path} 缺少 ${key};请用最新版 enroll-agent.mjs 重新生成`);
    }
  }
  return values;
}

/** mkdir 原子锁:已持锁且未过期则跳过本轮,防 cron 重叠起会话 */
function acquireLock(envPath) {
  const lockDir = `${envPath}.lock`;
  try {
    mkdirSync(lockDir);
    return lockDir;
  } catch {
    const age = Date.now() - statSync(lockDir).mtimeMs;
    if (age > LOCK_STALE_MS) {
      rmSync(lockDir, { recursive: true, force: true });
      try {
        mkdirSync(lockDir);
        return lockDir;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function releaseLock(lockDir) {
  if (lockDir !== undefined) {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

async function fetchInbox(values) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INBOX_TIMEOUT_MS);
  try {
    const url = new URL("/api/a2a/inbox?wait=0", values.CONSOLE_URL);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${values.AW_AGENT_ID}.${values.AW_AGENT_SECRET}` },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      throw new Error(`收件箱拉取失败(HTTP ${response.status})`);
    }
    const body = await response.json();
    return Array.isArray(body?.items) ? body.items : [];
  } finally {
    clearTimeout(timer);
  }
}

const PROMPT = `这是一次由执行面调度器发起的协作唤醒:你的 a2a 收件箱存在未处理消息。这不是群通知,群回复纪律(NOREPLY 抑制)不适用于本次会话;在没有完成下列步骤之前,禁止直接结束回合。
按序完成:
1) 调 a2a_inbox 拉取完整消息,记下 msg_id 与 thread_id;
2) request/escalate:先 task_create 建「你自己名下」的下游任务,再 a2a_ack(msg_id=收到的消息, task_id=你的任务);reply:阅读并 a2a_ack 确认;notify:阅读并 a2a_ack;
3) 执行消息要求的本职工作(读文件、查代码、写结论);
4) a2a_send 回执:task_id 用你自己的任务,必须带 thread_id 回原线程,intent=reply,reply_to=收到的 msg_id,结论写进 summary,deadline 必填;
5) task_update 按合法路径推进状态直至关单(pending→running→done,不允许跳级)。
过程与结论只写进回执与任务字段。全部步骤完成后,最终回复用一句话概述处理结果(消息条数与任务 id)。`;

function runSession(options, mcpConfigPath, serverName) {
  const cwd = options.cwd ?? process.cwd();
  if (!existsSync(cwd)) {
    throw new Error(`--cwd 不存在: ${cwd};请改为目标机器上真实存在的仓库目录`);
  }
  const allowed = ["Read", "Grep", "Glob", "Bash", `mcp__${serverName}`];
  // launchd 环境 PATH 极简:claude(npm 包,shebang 为 `env node`)与 node 本体
  // 可能都在 nvm/volta 等目录,子进程 PATH 注入两者目录,否则 shebang 解析 ENOENT
  const childPath = [
    path.dirname(path.resolve(options.claude ?? "claude")),
    path.dirname(process.execPath),
    process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
  ].join(":");
  const result = spawnSync(
    options.claude ?? "claude",
    [
      "-p",
      PROMPT,
      "--mcp-config",
      mcpConfigPath,
      "--strict-mcp-config",
      "--allowedTools",
      allowed.join(","),
    ],
    {
      cwd,
      env: { ...process.env, PATH: childPath },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: SESSION_TIMEOUT_MS,
      encoding: "utf8",
    },
  );
  if (result.error !== undefined) {
    throw new Error(`会话启动失败:${result.error.message}`);
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`会话退出码 ${result.status};消息保留在收件箱,下一轮重试`);
  }
  const summary = (result.stdout ?? "").trim().split("\n").at(-1) ?? "";
  process.stdout.write(`会话执行完成:${summary.slice(0, 200)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const values = parseEnvFile(options.env);
  const lockDir = acquireLock(options.env);
  if (lockDir === undefined) {
    process.stdout.write("上一轮会话仍在执行,跳过本轮\n");
    return;
  }
  try {
    const items = await fetchInbox(values);
    if (items.length === 0) {
      process.stdout.write("收件箱为空\n");
      return;
    }
    process.stdout.write(`收件箱 ${items.length} 条待处理,起会话\n`);
    const mcpConfigPath =
      options["mcp-config"] ?? `${options.env.slice(0, -4)}.mcp.json`;
    if (!existsSync(mcpConfigPath)) {
      throw new Error(`找不到 ${mcpConfigPath};请用最新版 enroll-agent.mjs 重新生成`);
    }
    // server 名以 mcp.json 实际键为准(enroll 可用 --name 覆盖默认 aw-<project>)
    const mcpServers = JSON.parse(readFileSync(mcpConfigPath, "utf8")).mcpServers ?? {};
    const serverName = Object.keys(mcpServers)[0];
    if (serverName === undefined) {
      throw new Error(`${mcpConfigPath} 里没有 mcpServers 配置`);
    }
    runSession(options, mcpConfigPath, serverName);
  } finally {
    releaseLock(lockDir);
  }
}

await main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
