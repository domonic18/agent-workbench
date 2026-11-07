import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { ensureStateDirs } from "./config.js";
import { buildPlist, readPlistEnv, type InstallOptions } from "./plist.js";

export const LABEL = "com.agent-workbench.aw-node";
/** 旧基线 label:升级时一并摘除,避免双服务并存 */
export const LEGACY_LABEL = "com.agent-workbench.collector";

export interface LaunchctlResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** launchctl 调用入口;测试可注入假实现,不必真跑 launchd */
export type LaunchctlRunner = (args: string[]) => LaunchctlResult;

export function runLaunchctl(args: string[]): LaunchctlResult {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

export function plistPath(label: string): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

/**
 * 先删后拷地替换二进制。
 * 直接覆盖已签名的二进制会留下失效签名,launchd 拉起时进程被 SIGKILL(exit 137),
 * 表现为服务刚装上就消失——必须先 unlink 再拷。
 */
export function replaceBinary(target: string, source: string): void {
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  rmSync(target, { force: true });
  copyFileSync(source, target);
  chmodSync(target, 0o755);
}

/** 编译产物的落位路径;launchd 只认这个路径,换版即换这个文件 */
function binaryPath(): string {
  return join(homedir(), ".local", "bin", "aw-node");
}

/**
 * plist 的 ProgramArguments。
 * node 直跑时是 [node, 脚本, run];编译产物是 [二进制, run]。
 * 返回 needsExecutableCheck 表示该路径必须在装载前校验可执行。
 */
export function resolveProgramArgs(): { args: string[]; needsExecutableCheck: boolean } {
  const execPath = process.execPath;
  const scriptPath = process.argv[1];
  const runningAsNode = /(^|\/)node$/.test(basename(execPath));
  if (runningAsNode && scriptPath !== undefined) {
    return { args: [execPath, scriptPath, "run"], needsExecutableCheck: false };
  }
  return { args: [binaryPath(), "run"], needsExecutableCheck: true };
}

export function uid(): number {
  return process.getuid?.() ?? userInfo().uid;
}

/**
 * launchd 域候选:图形登录会话用 gui,没有图形会话(SSH / 无头)退回 user。
 * launchctl 对不可达的域一律报 5: Input/output error,不区分原因,
 * 所以装载必须逐个域试,不能只认 gui。
 */
export function domainTargets(uidValue: number): string[] {
  return [`gui/${uidValue}`, `user/${uidValue}`];
}

export function serviceRunning(label: string): boolean {
  return domainTargets(uid()).some(
    (domain) => runLaunchctl(["print", `${domain}/${label}`]).status === 0,
  );
}

/** 可执行性校验;返回 null 表示可执行,否则给出人可读原因 */
export function checkExecutable(path: string): string | null {
  if (!existsSync(path)) {
    return "文件不存在";
  }
  try {
    accessSync(path, constants.X_OK);
  } catch {
    return "没有可执行权限";
  }
  return null;
}

/** plutil -lint;返回 null 表示合法 */
export function lintPlist(path: string): string | null {
  const result = spawnSync("plutil", ["-lint", path], { encoding: "utf8" });
  if (result.status === 0) {
    return null;
  }
  return `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
}

/** launchd 拆除服务是异步的:bootout 返回后服务仍可能挂在域里,立刻重装会撞 EIO */
const DRAIN_POLL_MS = 200;
const DRAIN_MAX_POLLS = 25;
/** 同名重装的尝试次数 */
const BOOTSTRAP_ATTEMPTS = 3;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function serviceLoaded(run: LaunchctlRunner, domain: string, label: string): boolean {
  return run(["print", `${domain}/${label}`]).status === 0;
}

/** 等服务真正从域里消失;bootout 之后必须等,否则同名 bootstrap 报 5: Input/output error */
function drainService(run: LaunchctlRunner, domain: string, label: string): void {
  for (let i = 0; i < DRAIN_MAX_POLLS; i += 1) {
    if (!serviceLoaded(run, domain, label)) {
      return;
    }
    sleepSync(DRAIN_POLL_MS);
  }
}

export interface LoadOutcome {
  domain: string;
  /** 装载前的摘除动作(同名服务已存在时发生) */
  bootedOut: boolean;
}

/** 装载失败时回给人看的现场信息 */
export interface LoadDiagnostics {
  /** 二进制校验结果 */
  binary: string;
  /** plist 校验结果 */
  plist: string;
}

/**
 * 把服务装载进 launchd。
 * 逐域尝试(gui → user),同名服务已挂着或正在拆除时先摘干净再装,
 * 全域失败时抛出带诊断与手动重试命令的错误,不再只回一句 launchctl 原文。
 */
export function loadService(
  plist: string,
  label: string,
  run: LaunchctlRunner,
  domains: readonly string[],
  diagnostics: LoadDiagnostics,
): LoadOutcome {
  const availableDomains = domains.filter((domain) => run(["print", domain]).status === 0);
  if (availableDomains.length === 0) {
    throw new Error(
      `launchd 域不可达:${domains.join("、")} 都无法 print。`
      + `当前会话没有可用的 launchd 域(常见于未登录图形桌面),请在已登录桌面的会话中重试。`,
    );
  }
  const failures: { domain: string; message: string }[] = [];
  for (const domain of availableDomains) {
    let message = "";
    let bootedOut = false;
    for (let attempt = 1; attempt <= BOOTSTRAP_ATTEMPTS; attempt += 1) {
      const result = run(["bootstrap", domain, plist]);
      if (result.status === 0) {
        return { domain, bootedOut };
      }
      message = result.stderr || result.stdout;
      if (serviceLoaded(run, domain, label)) {
        // 同名服务还挂着:摘掉并等它真正消失,再试下一次
        run(["bootout", `${domain}/${label}`]);
        drainService(run, domain, label);
        bootedOut = true;
      } else {
        // 服务已不在,但上一次拆除可能还在收尾:稍等再试
        sleepSync(DRAIN_POLL_MS);
      }
    }
    failures.push({ domain, message });
  }
  const detail = failures.map((item) => `  ${item.domain}: ${item.message}`).join("\n");
  const manual = availableDomains
    .map(
      (domain) =>
        `  launchctl bootstrap ${domain} ${plist}\n  launchctl kickstart -k ${domain}/${label}`,
    )
    .join("\n");
  throw new Error(
    `launchd 装载失败:\n${detail}\n`
    + `诊断:\n`
    + `  可用域: ${availableDomains.join("、")}\n`
    + `  可执行文件: ${diagnostics.binary}\n`
    + `  plist 校验: ${diagnostics.plist}\n`
    + `手动重试:\n${manual}`,
  );
}

export function install(options: InstallOptions): void {
  if (process.platform !== "darwin") {
    throw new Error("当前只支持 macOS(launchd)");
  }
  ensureStateDirs(options.stateDir);
  const { args, needsExecutableCheck } = resolveProgramArgs();
  const program = args[0] ?? "";
  const domains = domainTargets(uid());
  // 旧基线 collector 服务若还在,先停掉并摘除 plist,保证每机单服务
  for (const domain of domains) {
    if (serviceLoaded(runLaunchctl, domain, LEGACY_LABEL)) {
      runLaunchctl(["bootout", `${domain}/${LEGACY_LABEL}`]);
      drainService(runLaunchctl, domain, LEGACY_LABEL);
    }
  }
  if (existsSync(plistPath(LEGACY_LABEL))) {
    rmSync(plistPath(LEGACY_LABEL));
  }
  const target = plistPath(options.label);
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  // 同名服务可能已挂在别的域里(旧版 load 或另一个会话),先摘干净再装载;
  // 拆除是异步的,必须等它真的消失,否则紧接着的 bootstrap 会撞 5: Input/output error
  for (const domain of domains) {
    if (serviceLoaded(runLaunchctl, domain, options.label)) {
      runLaunchctl(["bootout", `${domain}/${options.label}`]);
      drainService(runLaunchctl, domain, options.label);
    }
  }
  // 旧服务摘干净后再换二进制:先换会让仍在跑的服务撞上已被删掉的路径
  if (needsExecutableCheck && program !== process.execPath) {
    replaceBinary(program, process.execPath);
  }
  if (needsExecutableCheck) {
    const problem = checkExecutable(program);
    if (problem !== null) {
      throw new Error(`执行机程序不可用(${program}: ${problem});请重新安装 aw-node 后再试`);
    }
  }
  // 重装要保留既有 plist 里用户自己加的环境变量,不能只写 install 掌控的那几个键
  writeFileSync(target, buildPlist(options, args, readPlistEnv(target)), { mode: 0o600 });
  chmodSync(target, 0o600);
  const lint = lintPlist(target);
  if (lint !== null) {
    throw new Error(`生成的 plist 不合法: ${lint}`);
  }
  const outcome = loadService(target, options.label, runLaunchctl, domains, {
    binary: `${program}(${needsExecutableCheck ? "已校验可执行" : "脚本直跑"})`,
    plist: "通过",
  });
  runLaunchctl(["kickstart", "-k", `${outcome.domain}/${options.label}`]);
  console.log(`aw-node 已安装并启动: ${program}`);
  console.log(`machine_id: ${options.collectorId}`);
  console.log(`launchd 域: ${outcome.domain}`);
  console.log(`状态目录: ${options.stateDir}`);
  console.log("用 aw-node status 查看运行情况,aw-node doctor 做自检。");
}

export function uninstall(label: string, purge: boolean): void {
  for (const domain of domainTargets(uid())) {
    if (serviceLoaded(runLaunchctl, domain, label)) {
      runLaunchctl(["bootout", `${domain}/${label}`]);
      drainService(runLaunchctl, domain, label);
    }
  }
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
