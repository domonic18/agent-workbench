#!/usr/bin/env node
// 为单个 Agent 生成 MCP proxy 的启动包装与 claude mcp add 命令。
// 用法: AW_AGENT_SECRET=... node scripts/enroll-agent.mjs --agent-id agt_x --project demo [--task-id tsk_x]
// 密钥只写入 gitignored 的 workspace/mcp/*.env,不打印、不落库。

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = resolve(ROOT, "workspace/mcp");
const DEFAULT_PROXY = resolve(ROOT, "dist/mcp/proxy/main.js");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    consoleUrl: "http://127.0.0.1:8787",
    title: "接入联调任务",
    assigner: "enroll",
    upstreams: "[]",
    out: DEFAULT_OUT,
    proxy: DEFAULT_PROXY,
  };
  const names = {
    "--agent-id": "agentId",
    "--project": "project",
    "--console-url": "consoleUrl",
    "--task-id": "taskId",
    "--title": "title",
    "--assigner": "assigner",
    "--run-id": "runId",
    "--upstreams": "upstreams",
    "--grants": "grants",
    "--name": "name",
    "--out": "out",
    "--proxy": "proxy",
    "--secret-file": "secretFile",
    "--feishu-app-id": "feishuAppId",
    "--feishu-secret-file": "feishuSecretFile",
    "--feishu-cc-config": "feishuCcConfig",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--print-only") {
      options.printOnly = true;
      continue;
    }
    const key = names[arg];
    if (key === undefined) {
      fail(`未知参数 ${arg};用 --help 查看用法`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`${arg} 缺少取值`);
    }
    options[key] = value;
    i += 1;
  }
  return options;
}

const HELP = `用法:
  AW_AGENT_SECRET=<轮换时返回的明文> node scripts/enroll-agent.mjs --agent-id agt_x --project demo

参数:
  --agent-id <id>       必填,Agent id(agt_ 开头)
  --project <name>      必填,任务归属项目;默认也用它命名 MCP server
  --task-id <id>        复用已有任务;省略则调 POST /api/tasks 新建一个
  --console-url <url>   默认 http://127.0.0.1:8787
  --name <name>         MCP server 名,默认 aw-<project>
  --out <dir>           包装文件目录,默认 workspace/mcp(gitignored)
  --upstreams <json>    透传给 proxy 的 AW_UPSTREAMS,默认 []
  --grants <pairs>      透传给 proxy 的 AW_GRANTS,如 fs.exec:cap_1
  --run-id <id>         透传给 proxy 的 AW_RUN_ID,默认随机
  --secret-file <path>  从文件读取密钥(替代 AW_AGENT_SECRET 环境变量)
  --feishu-app-id <id>  该 Agent 自己的飞书应用 App ID;与飞书密钥同时提供才启用协作群通知
  --feishu-secret-file <path>  从文件读取飞书 App Secret(替代 AW_FEISHU_APP_SECRET)
  --feishu-cc-config <path>    指定 cc-connect 配置路径;省略时 proxy 按默认路径自动探测
  --print-only          只打印配置,不写文件

飞书凭据也可不传:proxy 启动时会按 --project 到 cc-connect 配置里找同名项目的
feishu 应用(app_id/app_secret)自动启用协作群通知;secret 只留在本机进程内存。
`;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sanitizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function requestJson(baseUrl, path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL(path, baseUrl), { ...init, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text === "" ? null : JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!options.agentId || !options.project) {
    fail("缺少 --agent-id 或 --project;用 --help 查看用法");
  }
  const secret =
    options.secretFile === undefined
      ? (process.env.AW_AGENT_SECRET ?? "")
      : readFileSync(options.secretFile, "utf8").trim();
  if (secret === "") {
    fail("未提供密钥:设置 AW_AGENT_SECRET 或使用 --secret-file(不要在命令行明文传密钥)");
  }
  const feishuSecret =
    options.feishuSecretFile === undefined
      ? (process.env.AW_FEISHU_APP_SECRET ?? "")
      : readFileSync(options.feishuSecretFile, "utf8").trim();
  const feishuEnabled = options.feishuAppId !== undefined || feishuSecret !== "";
  if (feishuEnabled && (options.feishuAppId === undefined || feishuSecret === "")) {
    fail("飞书凭据需同时提供 --feishu-app-id 与 AW_FEISHU_APP_SECRET/--feishu-secret-file");
  }
  const consoleUrl = options.consoleUrl.replace(/\/+$/, "");
  const name = sanitizeName(options.name ?? `aw-${options.project}`);
  if (name === "") {
    fail(`无法从 ${options.project} 生成合法的 MCP server 名,请显式传 --name`);
  }
  if (!options.printOnly && !existsSync(options.proxy)) {
    fail(`找不到 ${options.proxy};先运行 pnpm run build`);
  }
  let upstreams;
  try {
    upstreams = JSON.parse(options.upstreams);
  } catch {
    fail("--upstreams 不是合法 JSON");
  }
  if (!Array.isArray(upstreams)) {
    fail("--upstreams 必须是 JSON 数组");
  }

  const health = await requestJson(consoleUrl, "/healthz", { method: "GET" });
  if (health.status !== 200) {
    fail(`控制台不可达:${consoleUrl}/healthz 返回 HTTP ${health.status}`);
  }

  const authorization = `Bearer ${options.agentId}.${secret}`;
  let taskId = options.taskId;
  if (taskId === undefined) {
    const created = await requestJson(consoleUrl, "/api/tasks", {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        title: options.title,
        assigner: options.assigner,
        project: options.project,
      }),
    });
    taskId = created.body?.task?.id;
    if (created.status !== 201 || typeof taskId !== "string") {
      fail(`建任务失败(HTTP ${created.status}):${JSON.stringify(created.body)}`);
    }
  }

  const runId = options.runId ?? `run_${randomUUID()}`;
  const envLines = [
    ["AW_RUN_ID", runId],
    ["AW_AGENT_ID", options.agentId],
    ["AW_AGENT_SECRET", secret],
    ["CONSOLE_URL", consoleUrl],
    ["AW_TASK_ID", taskId],
    ["AW_PROJECT", options.project],
    ["AW_UPSTREAMS", JSON.stringify(upstreams)],
    ...(options.grants === undefined ? [] : [["AW_GRANTS", options.grants]]),
    ...(options.feishuCcConfig === undefined
      ? []
      : [["FEISHU_CC_CONFIG", options.feishuCcConfig]]),
    ...(feishuEnabled
      ? [
          ["FEISHU_APP_ID", options.feishuAppId],
          ["FEISHU_APP_SECRET", feishuSecret],
        ]
      : []),
  ];
  const wrapperDir = resolve(options.out);
  const envPath = resolve(wrapperDir, `${name}.env`);
  const wrapperPath = resolve(wrapperDir, `${name}.sh`);
  const mcpConfigPath = resolve(wrapperDir, `${name}.mcp.json`);
  const wrapper = `#!/bin/sh
set -eu
set -a
. "${envPath}"
set +a
exec node "${options.proxy}"
`;
  const mcpConfig = `${JSON.stringify({ mcpServers: { [name]: { command: wrapperPath } } }, null, 2)}\n`;

  if (!options.printOnly) {
    mkdirSync(wrapperDir, { recursive: true, mode: 0o700 });
    writeFileSync(envPath, `${envLines.map(([key, value]) => `${key}=${shellQuote(value)}`).join("\n")}\n`, {
      mode: 0o600,
    });
    writeFileSync(wrapperPath, wrapper, { mode: 0o700 });
    writeFileSync(mcpConfigPath, mcpConfig, { mode: 0o600 });
    chmodSync(envPath, 0o600);
    chmodSync(wrapperPath, 0o700);
    chmodSync(mcpConfigPath, 0o600);
  }

  process.stdout.write(
    [
      `Agent ${options.agentId} · 任务 ${taskId} · 控制台 ${consoleUrl}`,
      "",
      `MCP server 名: ${name}`,
      options.printOnly ? "(--print-only:未写文件)" : `包装脚本: ${wrapperPath}`,
      options.printOnly ? "" : `环境文件: ${envPath}(含密钥,勿提交)`,
      "",
      "在项目目录注册到 Claude Code(仅本机、仅当前项目):",
      `  claude mcp add --scope local ${name} -- ${wrapperPath}`,
      "",
      "协作唤醒调度(2026-11-02 裁决:群 @ 不再唤醒,收件箱确定性拉起):",
      `  cc-connect cron add --cron "* * * * *" --exec "node ${resolve(ROOT, "scripts/aw-dispatch.mjs")} --env ${envPath} --cwd <项目仓库目录>" --desc "aw-dispatch ${options.project}"`,
      "",
      "验证:",
      "  claude mcp list",
      `  claude mcp remove ${name}`,
      "",
      "轮换密钥后重新运行本脚本,再在 Claude Code 里重启会话。",
      "",
    ].join("\n"),
  );
}

await main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
