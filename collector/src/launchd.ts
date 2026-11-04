import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { ensureStateDirs } from "./config.js";

export const LABEL = "com.agent-workbench.aw-node";
/** 旧基线 label:升级时一并摘除,避免双服务并存 */
export const LEGACY_LABEL = "com.agent-workbench.collector";

export interface InstallOptions {
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

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function plistPath(label: string): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function installBinary(): string {
  const target = join(homedir(), ".local", "bin", "aw-node");
  const execPath = process.execPath;
  const runningAsNode = /(^|\/)node$/.test(basename(execPath));
  if (runningAsNode || execPath === target) {
    return target;
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  copyFileSync(execPath, target);
  chmodSync(target, 0o755);
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

export function buildPlist(options: InstallOptions, binary: string): string {
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
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(options.label)}</string>
  <key>ProgramArguments</key><array>${args}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xmlEscape(join(options.stateDir, "aw-node.log"))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(join(options.stateDir, "aw-node.err"))}</string>
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

export function uid(): number {
  return process.getuid?.() ?? userInfo().uid;
}

export function serviceRunning(label: string): boolean {
  return launchctl(["print", `gui/${uid()}/${label}`], true);
}

export function install(options: InstallOptions): void {
  if (process.platform !== "darwin") {
    throw new Error("当前只支持 macOS(launchd)");
  }
  ensureStateDirs(options.stateDir);
  const binary = installBinary();
  // 旧基线 collector 服务若还在,先停掉并摘除 plist,保证每机单服务
  launchctl(["bootout", `gui/${uid()}/${LEGACY_LABEL}`], true);
  if (existsSync(plistPath(LEGACY_LABEL))) {
    rmSync(plistPath(LEGACY_LABEL));
  }
  const target = plistPath(options.label);
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  launchctl(["bootout", `gui/${uid()}/${options.label}`], true);
  writeFileSync(target, buildPlist(options, binary), { mode: 0o600 });
  chmodSync(target, 0o600);
  launchctl(["bootstrap", `gui/${uid()}`, target]);
  launchctl(["kickstart", "-k", `gui/${uid()}/${options.label}`], true);
  console.log(`aw-node 已安装并启动: ${binary}`);
  console.log(`machine_id: ${options.collectorId}`);
  console.log(`状态目录: ${options.stateDir}`);
  console.log("用 aw-node status 查看运行情况,aw-node doctor 做自检。");
}

export function uninstall(label: string, purge: boolean): void {
  launchctl(["bootout", `gui/${uid()}/${label}`], true);
  const target = plistPath(label);
  if (existsSync(target)) {
    rmSync(target);
  }
  const stateDir = process.env.AW_STATE_DIR ?? join(homedir(), ".aw-node");
  if (purge && existsSync(stateDir)) {
    rmSync(stateDir, { recursive: true, force: true });
  }
  console.log(`已卸载 launchd 服务 ${label}${purge ? " 与本地状态" : "(状态保留)"}`);
}
