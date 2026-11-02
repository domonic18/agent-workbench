import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

export interface FeishuCredentials {
  appId: string;
  appSecret: string;
}

export interface CcFeishuResult {
  credentials?: FeishuCredentials;
  /** 未解析到时的原因,供 proxy 启动日志记录;不含任何密钥 */
  reason?: string;
}

function candidatePaths(home: string): string[] {
  return [
    "/opt/homebrew/etc/cc-connect/config.toml",
    join(home, ".config", "cc-connect", "config.toml"),
    join(home, ".cc-connect", "config.toml"),
  ];
}

/** 显式 FEISHU_CC_CONFIG 优先(即便不存在也照用,便于日志报出真实原因);否则取首个存在的默认路径 */
export function locateCcConfig(
  env: { FEISHU_CC_CONFIG?: string | undefined } = process.env,
  home: string = homedir(),
  candidates: readonly string[] = candidatePaths(home),
): string | undefined {
  const explicit = env.FEISHU_CC_CONFIG?.trim();
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  return candidates.find((path) => existsSync(path));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 从 cc-connect 配置定位该项目的飞书应用凭据;任何异常都降级为 reason,不抛错 */
export function readFeishuCredentials(
  configPath: string,
  project: string,
): CcFeishuResult {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    return { reason: `无法读取 cc-connect 配置: ${configPath}` };
  }

  let doc: Record<string, unknown>;
  try {
    doc = asRecord(parseToml(text)) ?? {};
  } catch {
    return { reason: `cc-connect 配置不是合法 TOML: ${configPath}` };
  }

  const projects = doc.projects;
  if (!Array.isArray(projects)) {
    return { reason: "cc-connect 配置缺少 projects" };
  }

  for (const raw of projects) {
    const entry = asRecord(raw);
    if (entry === undefined || entry.name !== project) {
      continue;
    }
    const platforms = entry.platforms;
    if (!Array.isArray(platforms)) {
      return { reason: `项目 ${project} 未配置 platforms` };
    }
    for (const rawPlatform of platforms) {
      const platform = asRecord(rawPlatform);
      if (platform === undefined || platform.type !== "feishu") {
        continue;
      }
      const options = asRecord(platform.options);
      const appId = textOf(options?.app_id);
      const appSecret = textOf(options?.app_secret);
      if (appId === "" || appSecret === "") {
        return { reason: `项目 ${project} 的 feishu 平台缺少 app_id/app_secret` };
      }
      return { credentials: { appId, appSecret } };
    }
    return { reason: `项目 ${project} 没有 feishu 平台` };
  }

  return { reason: `cc-connect 配置中找不到项目 ${project}` };
}
