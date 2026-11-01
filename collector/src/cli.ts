import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { loadAttributionIndex } from "./attribution.js";
import {
  COLLECTOR_VERSION,
  ensureStateDirs,
  loadConfig,
  normalizeIngestUrl,
  type CollectorConfig,
} from "./config.js";
import { createDaemon, classifyStream, listSessionFiles } from "./daemon.js";
import { createConsoleClient } from "./http.js";
import { createLogger } from "./log.js";
import { loadState, sortedStreams, streamIdFor } from "./state.js";

const LABEL = "com.agent-workbench.collector";

interface InstallOptions {
  url: string;
  collectorId: string;
  secret: string;
  projects: string[];
  stateDir: string;
  backfill: boolean;
  label: string;
  claudeDir: string | null;
  ccConnectDir: string | null;
}

function argValue(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) {
    return null;
  }
  return argv[index + 1] ?? null;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function plistPath(label: string): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function installBinary(): string {
  const target = join(homedir(), ".local", "bin", "aw-collector");
  const execPath = process.execPath;
  const scriptPath = process.argv[1];
  const runningAsNode = /(^|\/)node$/.test(basename(execPath));
  if (runningAsNode) {
    return target;
  }
  if (execPath === target) {
    return target;
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  copyFileSync(execPath, target);
  chmodSync(target, 0o755);
  if (scriptPath === undefined) {
    return target;
  }
  return target;
}

function programArgs(binary: string): string[] {
  const execPath = process.execPath;
  const scriptPath = process.argv[1];
  const runningAsNode = /(^|\/)node$/.test(basename(execPath));
  if (runningAsNode && scriptPath !== undefined) {
    return [execPath, scriptPath, "run"];
  }
  return [binary, "run"];
}

function buildPlist(options: InstallOptions, binary: string): string {
  const env: Record<string, string> = {
    AW_INGEST_URL: options.url,
    AW_COLLECTOR_ID: options.collectorId,
    AW_COLLECTOR_SECRET: options.secret,
    AW_STATE_DIR: options.stateDir,
  };
  if (options.projects.length > 0) {
    env.AW_AGENT_PROJECTS = options.projects.join(",");
  }
  if (options.backfill) {
    env.AW_BACKFILL = "1";
  }
  if (options.claudeDir !== null) {
    env.AW_CLAUDE_DIR = options.claudeDir;
  }
  if (options.ccConnectDir !== null) {
    env.AW_CC_CONNECT_DIR = options.ccConnectDir;
  }
  const envXml = Object.entries(env)
    .map(([key, value]) => `<key>${xmlEscape(key)}</key><string>${xmlEscape(value)}</string>`)
    .join("\n    ");
  const args = programArgs(binary)
    .map((arg) => `<string>${xmlEscape(arg)}</string>`)
    .join("");
  const logDir = options.stateDir;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(options.label)}</string>
  <key>ProgramArguments</key><array>${args}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xmlEscape(join(logDir, "collector.log"))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(join(logDir, "collector.err"))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    ${envXml}
  </dict>
</dict>
</plist>
`;
}

function launchctl(args: string[], ignoreFailure = false): boolean {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  if (result.status !== 0 && !ignoreFailure) {
    throw new Error(`launchctl ${args.join(" ")} 失败: ${result.stderr || result.stdout}`);
  }
  return result.status === 0;
}

function uid(): number {
  return process.getuid?.() ?? userInfo().uid;
}

function requireSecret(): string {
  const envSecret = process.env.AW_COLLECTOR_SECRET;
  if (envSecret !== undefined && envSecret.trim() !== "") {
    return envSecret.trim();
  }
  throw new Error("缺少采集器密钥:请通过 AW_COLLECTOR_SECRET 传入,或由安装脚本交互式输入");
}

function parseInstallOptions(argv: string[]): InstallOptions {
  const url = argValue(argv, "--url") ?? process.env.AW_INGEST_URL ?? "";
  const collectorId = argValue(argv, "--id") ?? process.env.AW_COLLECTOR_ID ?? "";
  if (url.trim() === "") {
    throw new Error("必须提供 --url(控制台地址)");
  }
  if (collectorId.trim() === "") {
    throw new Error("必须提供 --id(collector_id)");
  }
  normalizeIngestUrl(url);
  const projectsRaw = argValue(argv, "--projects") ?? process.env.AW_AGENT_PROJECTS ?? "";
  return {
    url: url.trim(),
    collectorId: collectorId.trim(),
    secret: requireSecret(),
    projects: projectsRaw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
    stateDir: argValue(argv, "--state-dir") ?? process.env.AW_STATE_DIR ?? join(homedir(), ".aw-collector"),
    backfill: hasFlag(argv, "--backfill") || process.env.AW_BACKFILL === "1",
    label: argValue(argv, "--label") ?? LABEL,
    claudeDir: argValue(argv, "--claude-dir") ?? null,
    ccConnectDir: argValue(argv, "--cc-connect-dir") ?? null,
  };
}

function install(options: InstallOptions): void {
  if (process.platform !== "darwin") {
    throw new Error("当前只支持 macOS(launchd)");
  }
  ensureStateDirs(options.stateDir);
  const binary = installBinary();
  const target = plistPath(options.label);
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  launchctl(["bootout", `gui/${uid()}/${options.label}`], true);
  writeFileSync(target, buildPlist(options, binary), { mode: 0o600 });
  chmodSync(target, 0o600);
  launchctl(["bootstrap", `gui/${uid()}`, target]);
  launchctl(["kickstart", "-k", `gui/${uid()}/${options.label}`], true);
  console.log(`采集器已安装并启动: ${binary}`);
  console.log(`collector_id: ${options.collectorId}`);
  console.log(`状态目录: ${options.stateDir}`);
  console.log("用 aw-collector status 查看运行情况,aw-collector doctor 做自检。");
}

function uninstall(label: string, purge: boolean): void {
  launchctl(["bootout", `gui/${uid()}/${label}`], true);
  const target = plistPath(label);
  if (existsSync(target)) {
    rmSync(target);
  }
  const stateDir = process.env.AW_STATE_DIR ?? join(homedir(), ".aw-collector");
  if (purge && existsSync(stateDir)) {
    rmSync(stateDir, { recursive: true, force: true });
  }
  console.log(`已卸载 launchd 服务 ${label}${purge ? " 与本地状态" : "(状态保留)"}`);
}

function status(argv: string[]): number {
  const config = loadConfig({ requireAuth: false });
  const state = loadState(config.stateDir);
  const streams = sortedStreams(state);
  const counts = { ok: 0, unregistered: 0, ambiguous: 0, unattributed: 0 };
  for (const stream of streams) {
    counts[stream.status] += 1;
  }
  let spoolBytes = 0;
  try {
    const dir = join(config.stateDir, "spool");
    for (const file of existsSync(dir) ? readdirSync(dir) : []) {
      if (file.endsWith(".jsonl")) {
        spoolBytes += statSync(join(dir, file)).size;
      }
    }
  } catch {
    spoolBytes = 0;
  }
  const running = launchctl(["print", `gui/${uid()}/${LABEL}`], true);
  const payload = {
    state_dir: config.stateDir,
    running,
    streams: streams.length,
    status_counts: counts,
    spool_bytes: spoolBytes,
    last_errors: streams
      .filter((stream) => stream.lastError !== null)
      .slice(0, 5)
      .map((stream) => ({ stream: streamIdFor(stream.sessionId, stream.epoch), error: stream.lastError })),
  };
  if (hasFlag(argv, "--json")) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }
  console.log(`状态目录: ${payload.state_dir}`);
  console.log(`launchd: ${running ? "运行中" : "未运行"}`);
  console.log(
    `会话流: ${payload.streams}(正常 ${counts.ok} / 未登记 ${counts.unregistered} / 歧义 ${counts.ambiguous} / 未归因 ${counts.unattributed})`,
  );
  console.log(`spool: ${(spoolBytes / 1024).toFixed(1)} KiB`);
  if (payload.last_errors.length > 0) {
    for (const item of payload.last_errors) {
      console.log(`最近错误 ${item.stream}: ${item.error}`);
    }
  }
  return 0;
}

async function doctor(): Promise<number> {
  const config = loadConfig();
  const client = createConsoleClient({
    ingestUrl: config.ingestUrl,
    baseUrl: config.baseUrl,
    collectorId: config.collectorId,
    secret: config.secret,
    timeoutMs: config.requestTimeoutMs,
  });
  let failures = 0;
  const report = (ok: boolean, label: string, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
    if (!ok) {
      failures += 1;
    }
  };

  report(existsSync(config.claudeDir), "Claude 目录", config.claudeDir);
  report(existsSync(config.ccConnectDir), "cc-connect 目录", config.ccConnectDir);
  report(await client.healthz(), "控制台 /healthz", config.baseUrl);

  const registered = new Set(config.registeredProjects);
  try {
    const projects = await client.getProjects();
    if (projects.length > 0) {
      registered.clear();
      for (const project of projects) {
        registered.add(project);
      }
    }
    report(true, "采集器鉴权", `已登记项目 ${projects.join(", ") || "(空)"}`);
  } catch (error) {
    report(false, "采集器鉴权", error instanceof Error ? error.message : String(error));
  }

  const index = loadAttributionIndex(config.ccConnectDir);
  const files = listSessionFiles(config.claudeDir);
  const counts = { ok: 0, unregistered: 0, ambiguous: 0, unattributed: 0 };
  for (const file of files) {
    counts[classifyStream(index, file.sessionId, registered).status] += 1;
  }
  const known = index.projects();
  console.log(
    `INFO  归因: ${files.length} 条会话文件 / 正常 ${counts.ok} / 未登记 ${counts.unregistered} / 歧义 ${counts.ambiguous} / 未归因 ${counts.unattributed}`,
  );
  console.log(`INFO  cc-connect 项目: ${known.join(", ") || "(空)"}`);
  if (registered.size > 0) {
    console.log(`INFO  本地已登记项目: ${[...registered].join(", ")}`);
  }
  return failures === 0 ? 0 : 1;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? "run";
  if (command === "version" || command === "--version" || command === "-v") {
    console.log(`aw-collector ${COLLECTOR_VERSION}`);
    return 0;
  }
  if (command === "run") {
    const config: CollectorConfig = loadConfig();
    const logger = createLogger();
    const daemon = createDaemon({ config, logger });
    await daemon.start();
    return 0;
  }
  if (command === "status") {
    return status(argv);
  }
  if (command === "doctor") {
    return doctor();
  }
  if (command === "install" || command === "upgrade") {
    install(parseInstallOptions(argv));
    return 0;
  }
  if (command === "uninstall") {
    uninstall(argValue(argv, "--label") ?? LABEL, hasFlag(argv, "--purge"));
    return 0;
  }
  console.error(`未知命令: ${command}`);
  console.error("用法: aw-collector [run|status|doctor|install|upgrade|uninstall|version]");
  return 2;
}
