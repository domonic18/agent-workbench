import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 装载 launchd 服务所需的参数 */
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

function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * 从 plist 文本里读出 EnvironmentVariables。
 * 重装要保留用户自己加的环境变量(GH_TOKEN、AW_EXTRA_PROJECTS 等),
 * 不能只认 install 自己那几个键,否则每次覆盖安装都会把配置抹掉。
 */
export function parsePlistEnv(xml: string): Record<string, string> {
  const section = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(xml)?.[1];
  if (section === undefined) {
    return {};
  }
  const env: Record<string, string> = {};
  const entry = /<key>([^<]*)<\/key>\s*<string>([\s\S]*?)<\/string>/g;
  let match = entry.exec(section);
  while (match !== null) {
    const [, rawKey, rawValue] = match;
    if (rawKey !== undefined && rawValue !== undefined) {
      env[xmlUnescape(rawKey)] = xmlUnescape(rawValue);
    }
    match = entry.exec(section);
  }
  return env;
}

/** 读既有 plist 的环境变量;文件不存在或读不出时返回空 */
export function readPlistEnv(plistFile: string): Record<string, string> {
  if (!existsSync(plistFile)) {
    return {};
  }
  try {
    return parsePlistEnv(readFileSync(plistFile, "utf8"));
  } catch {
    return {};
  }
}

/**
 * 合成要写进 plist 的环境变量。
 * install 自己掌控的四个键由本次参数决定;其余既有键原样带回;
 * 显式传入的可选参数(项目列表、backfill 等)才覆盖既有值。
 */
export function buildEnv(
  options: InstallOptions,
  existing: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {
    ...existing,
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
  return env;
}

export function buildPlist(
  options: InstallOptions,
  args: readonly string[],
  existingEnv: Record<string, string> = {},
): string {
  const env = buildEnv(options, existingEnv);
  const argsXml = args
    .map((arg) => `<string>${xmlEscape(arg)}</string>`)
    .join("");
  const envXml = Object.entries(env)
    .map(([key, value]) => `<key>${xmlEscape(key)}</key><string>${xmlEscape(value)}</string>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(options.label)}</string>
  <key>ProgramArguments</key><array>${argsXml}</array>
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
