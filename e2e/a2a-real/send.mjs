// A2A 真机实测发起侧:在发起方工作目录起真实 claude 会话完成委派
//
// 被测链路是 A2A 本身:发起方真起会话 → 建任务 → a2a_send(request);
// 对端唤醒与回执由执行面调度器完成,本脚本不代做。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { localAgentCwd, outDir, readBundle } from "./common.mjs";
import { senderPrompt } from "./prompts.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const scenarioIndex = process.argv.indexOf("--scenario");
const scenario = scenarioIndex === -1 ? "s1" : process.argv[scenarioIndex + 1];
const bundle = readBundle(scenario);

const CLAUDE_CANDIDATE_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local/bin")];

function resolveClaude() {
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter).filter((item) => item !== ""),
    ...CLAUDE_CANDIDATE_DIRS,
  ];
  for (const dir of dirs) {
    const candidate = join(dir, "claude");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("找不到 claude 可执行文件");
}

const cwd = localAgentCwd(bundle.sender.agentId);
if (cwd === undefined || !existsSync(cwd)) {
  throw new Error(`发起方 Agent ${bundle.sender.agentId} 的工作目录不可用:${cwd ?? "(未登记)"}`);
}

const deadline = new Date(Date.now() + bundle.deadlineMinutes * 60_000).toISOString();
const prompt = senderPrompt({
  targetAgentId: bundle.receiver.agentId,
  title: bundle.title,
  task: bundle.task,
  expect: bundle.expect,
  deadline,
});
const claudePath = resolveClaude();

console.log(`场景 ${scenario}:发起方 ${bundle.sender.agentId} → 接收方 ${bundle.receiver.agentId}`);
console.log(`工作目录 ${cwd}`);
console.log(`claude ${claudePath}`);
console.log("");

const child = spawn(
  claudePath,
  ["-p", prompt, "--allowedTools", "Read,Grep,Glob,Bash,mcp__aw-console"],
  {
    cwd,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString("utf8");
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

const timeout = setTimeout(() => {
  console.error("发起侧会话超时,终止");
  child.kill("SIGTERM");
}, 10 * 60_000);

child.on("close", (code) => {
  clearTimeout(timeout);
  const taskId = stdout.match(/tsk_[a-z0-9]+/)?.[0];
  console.log("--- 会话输出 ---");
  console.log(stdout.trim().split("\n").slice(-20).join("\n"));
  console.log("--- 结束 ---");
  console.log(`退出码 ${code}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, `${scenario}.send.json`),
    JSON.stringify({ scenario, taskId: taskId ?? null, at: Date.now(), exitCode: code }, null, 2),
    { mode: 0o600 },
  );
  if (code !== 0) {
    process.exitCode = 1;
  }
});
