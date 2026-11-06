import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadAttributionIndex } from "./attribution.js";
import {
  COLLECTOR_VERSION,
  loadConfig,
  normalizeIngestUrl,
  type CollectorConfig,
  type ConfigEnv,
} from "./config.js";
import { loadConfigSyncState } from "./config-sync.js";
import { mergeExtraProjects, scanDiscovery } from "./discovery.js";
import { createDaemon } from "./daemon.js";
import { classifyStream, listSessionFiles } from "./sessions.js";
import {
  enrollMachine,
  loadCredentials,
  readEnrollToken,
  saveCredentials,
  type EnrollCredentials,
} from "./enroll.js";
import { createConsoleClient } from "./http.js";
import {
  LABEL,
  LEGACY_LABEL,
  install,
  plistPath,
  serviceRunning,
  uninstall,
} from "./launchd.js";
import { createLogger } from "./log.js";
import { readPlistEnv, type InstallOptions } from "./plist.js";
import { loadState, sortedStreams, streamIdFor } from "./state.js";

/**
 * 诊断与状态命令要看的是「已安装服务在用的那套配置」,不是进程 env 的缺省值。
 * 终端里跑 doctor 时进程 env 通常是空的,AW_INGEST_URL 会缺省回退到
 * 127.0.0.1:8787,于是自检去检查一台根本没装控制台的机器——所以先回退到
 * launchd plist 里的 EnvironmentVariables,进程 env 仍然优先。
 */
export function diagnosticsEnv(plistFile: string = plistPath(LABEL)): ConfigEnv {
  return { ...readPlistEnv(plistFile), ...process.env };
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

/**
 * install/upgrade 的机器身份解析:优先 --id + AW_COLLECTOR_SECRET,
 * 缺失时回退 enroll 落盘的凭据;enroll 过的机器升级无需重复输入密钥。
 */
export function resolveInstallIdentity(
  argv: string[],
  credentials: EnrollCredentials | null,
): { collectorId: string; secret: string } {
  const id = argValue(argv, "--id") ?? process.env.AW_COLLECTOR_ID ?? "";
  const secret = process.env.AW_COLLECTOR_SECRET ?? "";
  if (id.trim() !== "" && secret.trim() !== "") {
    return { collectorId: id.trim(), secret: secret.trim() };
  }
  if (credentials !== null && credentials.machineId !== "" && credentials.secret !== "") {
    return { collectorId: credentials.machineId, secret: credentials.secret };
  }
  throw new Error("缺少机器身份:先运行 aw-node enroll,或提供 --id 与 AW_COLLECTOR_SECRET");
}

function installFlags(argv: string[], url: string, identity: { collectorId: string; secret: string }): InstallOptions {
  return {
    url: url.trim(),
    collectorId: identity.collectorId,
    secret: identity.secret,
    projects: (argValue(argv, "--projects") ?? process.env.AW_AGENT_PROJECTS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
    stateDir:
      argValue(argv, "--state-dir") ?? process.env.AW_STATE_DIR ?? join(homedir(), ".aw-node"),
    backfill: hasFlag(argv, "--backfill") || process.env.AW_BACKFILL === "1",
    label: argValue(argv, "--label") ?? LABEL,
    claudeDir: argValue(argv, "--claude-dir") ?? null,
    ccConnectDir: argValue(argv, "--cc-connect-dir") ?? null,
  };
}

function parseInstallOptions(argv: string[]): InstallOptions {
  const url = argValue(argv, "--url") ?? process.env.AW_INGEST_URL ?? "";
  if (url.trim() === "") {
    throw new Error("必须提供 --url(控制台地址)");
  }
  normalizeIngestUrl(url);
  const stateDir =
    argValue(argv, "--state-dir") ?? process.env.AW_STATE_DIR ?? join(homedir(), ".aw-node");
  const identity = resolveInstallIdentity(argv, loadCredentials(stateDir));
  return installFlags(argv, url, identity);
}

/**
 * 一次性加入(04 §8):enroll token 兑换机器身份 → 凭据 0600 落盘 → 安装 launchd。
 * 令牌经 env / stdin / 隐藏输入传入,永不进命令行参数与日志。
 */
async function enrollCommand(argv: string[]): Promise<number> {
  const rawUrl = argValue(argv, "--url") ?? process.env.AW_INGEST_URL ?? "";
  if (rawUrl.trim() === "") {
    throw new Error("必须提供 --url(控制台地址)");
  }
  const { baseUrl } = normalizeIngestUrl(rawUrl);
  const flags = installFlags(argv, baseUrl, { collectorId: "", secret: "" });
  const token = await readEnrollToken({ env: process.env.AW_ENROLL_TOKEN });
  const response = await enrollMachine({ consoleUrl: baseUrl, token });
  saveCredentials(flags.stateDir, {
    consoleUrl: baseUrl,
    machineId: response.machine_id,
    secret: response.collector_secret,
  });
  install({ ...flags, collectorId: response.machine_id, secret: response.collector_secret });
  console.log("控制台将在发现上报后预填项目;到 /setup 确认主责 Agent 即可完成初始化。");
  return 0;
}

function status(argv: string[]): number {
  const config = loadConfig({ requireAuth: false, env: diagnosticsEnv() });
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
  const credentials = loadCredentials(config.stateDir);
  const syncState = loadConfigSyncState(config.stateDir);
  const running = serviceRunning(LABEL);
  const legacyInstalled = existsSync(plistPath(LEGACY_LABEL));
  const payload = {
    state_dir: config.stateDir,
    machine_id: credentials?.machineId ?? null,
    running,
    streams: streams.length,
    status_counts: counts,
    spool_bytes: spoolBytes,
    config_agents: Object.keys(syncState.agents).length,
    config_synced_at: syncState.lastSyncAt,
    legacy_service: legacyInstalled,
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
  console.log(`machine_id: ${payload.machine_id ?? "(未 enroll)"}`);
  console.log(`launchd: ${running ? "运行中" : "未运行"}`);
  console.log(
    `会话流: ${payload.streams}(正常 ${counts.ok} / 未登记 ${counts.unregistered} / 歧义 ${counts.ambiguous} / 未归因 ${counts.unattributed})`,
  );
  console.log(`spool: ${(spoolBytes / 1024).toFixed(1)} KiB`);
  console.log(
    `配置同步: ${payload.config_agents} 个 Agent / ${
      syncState.lastSyncAt === null ? "未同步" : new Date(syncState.lastSyncAt).toISOString()
    }`,
  );
  if (legacyInstalled) {
    console.log(`警告: 检测到旧版 collector plist,执行 aw-node uninstall --label ${LEGACY_LABEL} 清理`);
  }
  if (payload.last_errors.length > 0) {
    for (const item of payload.last_errors) {
      console.log(`最近错误 ${item.stream}: ${item.error}`);
    }
  }
  return 0;
}

async function doctor(): Promise<number> {
  const config = loadConfig({ requireAuth: false, env: diagnosticsEnv() });
  const credentials = loadCredentials(config.stateDir);
  const collectorId = config.collectorId !== "" ? config.collectorId : credentials?.machineId ?? "";
  const secret = config.secret !== "" ? config.secret : credentials?.secret ?? "";
  const client = createConsoleClient({
    ingestUrl: config.ingestUrl,
    baseUrl: config.baseUrl,
    collectorId,
    secret,
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
  report(
    credentials !== null,
    "机器凭据",
    credentials === null ? "未 enroll:先运行 aw-node enroll" : `machine_id ${credentials.machineId}`,
  );
  report(await client.healthz(), "控制台 /healthz", config.baseUrl);

  if (collectorId !== "" && secret !== "") {
    try {
      const projects = await client.getProjects();
      report(true, "采集器鉴权", `已登记项目 ${projects.join(", ") || "(空)"}`);
    } catch (error) {
      report(false, "采集器鉴权", error instanceof Error ? error.message : String(error));
    }
  }

  const discovery = mergeExtraProjects(scanDiscovery(config.ccConnectConfigs), config.extraProjects);
  const known = discovery.projects.map((project) =>
    project.cwd === undefined ? project.name : `${project.name}(${project.cwd})`,
  );
  console.log(`INFO  发现扫描: ${known.join(", ") || "(空)"}`);

  const syncState = loadConfigSyncState(config.stateDir);
  const agentSummary = Object.entries(syncState.agents)
    .map(([agentId, applied]) => `${agentId} → ${applied.cwd}`)
    .join(", ");
  console.log(
    `INFO  配置同步: ${Object.keys(syncState.agents).length} 个 Agent / ${
      syncState.lastSyncAt === null ? "未同步" : new Date(syncState.lastSyncAt).toISOString()
    }${agentSummary === "" ? "" : ` / ${agentSummary}`}`,
  );

  const index = loadAttributionIndex(config.ccConnectDir);
  const files = listSessionFiles(config.claudeDir);
  const counts = { ok: 0, unregistered: 0, ambiguous: 0, unattributed: 0 };
  const registered = new Set(config.registeredProjects);
  for (const file of files) {
    counts[classifyStream(index, file.sessionId, registered).status] += 1;
  }
  console.log(
    `INFO  归因: ${files.length} 条会话文件 / 正常 ${counts.ok} / 未登记 ${counts.unregistered} / 歧义 ${counts.ambiguous} / 未归因 ${counts.unattributed}`,
  );
  console.log(`INFO  cc-connect 项目: ${index.projects().join(", ") || "(空)"}`);
  if (registered.size > 0) {
    console.log(`INFO  本地已登记项目: ${[...registered].join(", ")}`);
  }
  return failures === 0 ? 0 : 1;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? "run";
  if (command === "version" || command === "--version" || command === "-v") {
    console.log(`aw-node ${COLLECTOR_VERSION}`);
    return 0;
  }
  if (command === "run") {
    const config: CollectorConfig = loadConfig();
    const logger = createLogger();
    const daemon = createDaemon({ config, logger });
    await daemon.start();
    return 0;
  }
  if (command === "enroll") {
    return enrollCommand(argv);
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
  console.error("用法: aw-node [run|enroll|status|doctor|install|upgrade|uninstall|version]");
  return 2;
}
