import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { DiscoveryProjectReport, DiscoveryReport } from "../../src/shared/aw-node-wire.js";

/**
 * cc-connect 发现扫描(04 §8):读本机 cc-connect 配置中的项目/目录/Agent/渠道元数据,
 * 白名单提取——app_id/app_secret/env 等敏感字段永不进入上报。
 */

export const DEFAULT_CONFIG_CANDIDATES = [
  join(homedir(), ".cc-connect", "config.toml"),
  "/opt/homebrew/etc/cc-connect/config.toml",
];

/** 空列表与 undefined 同义回退默认候选——loadConfig 未设 AW_CC_CONNECT_CONFIG 时给出空数组 */
export function resolveConfigPaths(configPaths?: string[]): string[] {
  return configPaths === undefined || configPaths.length === 0
    ? DEFAULT_CONFIG_CANDIDATES
    : configPaths;
}

interface CcConnectAgent {
  type?: unknown;
  options?: { work_dir?: unknown };
  providers?: Array<{ models?: Array<Record<string, unknown>> }>;
}

interface CcConnectProject {
  name?: unknown;
  agent?: CcConnectAgent;
  platforms?: Array<{ type?: unknown }>;
}

/** 从单个已解析项目提取白名单字段;无名字段不完整则跳过 */
export function projectToReport(project: CcConnectProject): DiscoveryProjectReport | null {
  if (typeof project.name !== "string" || project.name.trim() === "") {
    return null;
  }
  const agent = project.agent ?? {};
  const cwd = typeof agent.options?.work_dir === "string" ? agent.options.work_dir : undefined;
  const models = (agent.providers ?? [])
    .flatMap((provider) => provider.models ?? [])
    .map((model) => model.alias)
    .filter((alias): alias is string => typeof alias === "string");
  const agents = [
    {
      ...(typeof agent.type === "string" ? { type: agent.type } : {}),
      ...(models.length > 0 ? { models } : {}),
    },
  ];
  const channels = (project.platforms ?? [])
    .map((platform) => (typeof platform.type === "string" ? { type: platform.type } : null))
    .filter((channel): channel is { type: string } => channel !== null);

  return {
    name: project.name.trim(),
    ...(cwd === undefined ? {} : { cwd }),
    agents,
    channels,
  };
}

/** 逐个解析候选配置,按项目名合并(brew 装机配置与用户目录配置可能同时存在) */
export function scanDiscovery(configPaths?: string[]): DiscoveryReport {
  const paths = resolveConfigPaths(configPaths);
  const merged = new Map<string, DiscoveryProjectReport>();
  for (const path of paths) {
    if (!existsSync(path)) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = parseToml(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    const projects = (parsed as { projects?: unknown }).projects;
    if (!Array.isArray(projects)) {
      continue;
    }
    for (const raw of projects) {
      const report = projectToReport(raw as CcConnectProject);
      if (report === null) {
        continue;
      }
      const existing = merged.get(report.name);
      // 合并时保留信息更全的一条(带 cwd 的优先)
      const fuller =
        existing === undefined || (existing.cwd === undefined && report.cwd !== undefined)
          ? report
          : existing;
      merged.set(report.name, fuller);
    }
  }
  return { projects: [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
