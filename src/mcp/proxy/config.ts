import { z } from "zod";
import type { Grant, RunContext } from "../../domain/capability/gate.js";
import {
  locateCcConfig,
  readFeishuCredentials,
  type FeishuCredentials,
} from "./feishu-cc.js";
import type { UpstreamConfig } from "./upstream.js";

const upstreamSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "上游 id 只允许小写字母、数字与短横线(不含 __)"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  toolMap: z.record(z.string(), z.string()).optional(),
});

const envSchema = z.object({
  AW_RUN_ID: z.string().min(1),
  AW_AGENT_ID: z.string().min(1),
  /** 与控制台的 Agent Bearer 密钥;原生工具经 HTTP 触达时使用 */
  AW_AGENT_SECRET: z.string().min(1),
  CONSOLE_URL: z.string().url().default("http://127.0.0.1:8787"),
  AW_TASK_ID: z.string().min(1),
  AW_WORKSPACE_ROOT: z.string().min(1).optional(),
  /** 空数组 = 只挂原生工具,不接管任何上游 MCP server */
  AW_UPSTREAMS: z.string().min(1).default("[]"),
  AW_GRANTS: z.string().optional(),
  AW_APPROVAL_TIMEOUT_MS: z.coerce.number().int().min(1).optional(),
  /** 该 Agent 的 cc-connect 项目名;未显式配置飞书凭据时据此自动发现 */
  AW_PROJECT: z.string().min(1).optional(),
  // 各 Agent 自己的飞书应用凭据;两者同时配置才启用协作群通知
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  /** cc-connect 配置路径;留空按默认候选路径探测 */
  FEISHU_CC_CONFIG: z.string().optional(),
});

export interface ProxyConfig {
  agentSecret: string;
  consoleBaseUrl: string;
  approvalTimeoutMs: number | undefined;
  upstreams: UpstreamConfig[];
  toolMap: Record<string, Record<string, string>>;
  /** 未配置飞书凭据时不发协作群通知,工具调用照常 */
  feishu?: FeishuCredentials;
  /** 凭据来源:显式 env 或从 cc-connect 配置自动发现 */
  feishuSource?: "env" | "cc-config";
  /** 自动发现失败的原因,供启动日志记录;不影响工具通道 */
  feishuWarning?: string;
  ctx: RunContext;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

interface FeishuResolution {
  feishu?: FeishuCredentials;
  source?: "env" | "cc-config";
  warning?: string;
}

/**
 * 优先级:显式 env 凭据 → AW_PROJECT 对应的 cc-connect 配置 → 关闭协作通知。
 * cc-config 只在本机读取,secret 不进日志、不落库。
 */
function parseFeishu(data: z.infer<typeof envSchema>): FeishuResolution {
  const appId = optionalText(data.FEISHU_APP_ID);
  const appSecret = optionalText(data.FEISHU_APP_SECRET);
  if (appId !== undefined || appSecret !== undefined) {
    if (appId === undefined || appSecret === undefined) {
      throw new Error("FEISHU_APP_ID 与 FEISHU_APP_SECRET 必须同时设置");
    }
    return { feishu: { appId, appSecret }, source: "env" };
  }

  const project = optionalText(data.AW_PROJECT);
  if (project === undefined) {
    return {};
  }
  const configPath = locateCcConfig(data);
  if (configPath === undefined) {
    return { warning: "未找到 cc-connect 配置,飞书协作通知关闭" };
  }
  const result = readFeishuCredentials(configPath, project);
  if (result.credentials === undefined) {
    return { warning: result.reason ?? "未解析到飞书凭据,协作通知关闭" };
  }
  return { feishu: result.credentials, source: "cc-config" };
}

/** `AW_GRANTS` 为逗号分隔的 `tool:capabilityId`;格式错误即启动失败,不静默跳过 */
function parseGrants(value: string | undefined): Grant[] {
  if (value === undefined) {
    return [];
  }
  const grants: Grant[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (entry === "") {
      continue;
    }
    const index = entry.indexOf(":");
    const tool = index === -1 ? "" : entry.slice(0, index).trim();
    const capabilityId = index === -1 ? "" : entry.slice(index + 1).trim();
    if (tool === "" || capabilityId === "") {
      throw new Error(`AW_GRANTS 条目格式应为 tool:capabilityId: ${entry}`);
    }
    if (seen.has(tool)) {
      throw new Error(`AW_GRANTS 存在重复工具: ${tool}`);
    }
    seen.add(tool);
    grants.push({ tool, capabilityId });
  }
  return grants;
}

function parseUpstreams(raw: string): z.infer<typeof upstreamSchema>[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("AW_UPSTREAMS 不是合法 JSON");
  }
  const parsed = z.array(upstreamSchema).safeParse(decoded);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`AW_UPSTREAMS 校验失败: ${detail}`);
  }
  const ids = new Set(parsed.data.map((entry) => entry.id));
  if (ids.size !== parsed.data.length) {
    throw new Error("AW_UPSTREAMS 存在重复的上游 id");
  }
  return parsed.data;
}

export function loadProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`代理环境变量校验失败: ${detail}`);
  }
  const entries = parseUpstreams(parsed.data.AW_UPSTREAMS);
  const feishu = parseFeishu(parsed.data);
  const toolMap: Record<string, Record<string, string>> = {};
  for (const entry of entries) {
    if (entry.toolMap !== undefined) {
      toolMap[entry.id] = entry.toolMap;
    }
  }

  return {
    agentSecret: parsed.data.AW_AGENT_SECRET,
    consoleBaseUrl: parsed.data.CONSOLE_URL,
    approvalTimeoutMs: parsed.data.AW_APPROVAL_TIMEOUT_MS,
    upstreams: entries.map((entry) => ({
      id: entry.id,
      command: entry.command,
      args: entry.args,
      ...(entry.env === undefined ? {} : { env: entry.env }),
    })),
    toolMap,
    ...(feishu.feishu === undefined ? {} : { feishu: feishu.feishu }),
    ...(feishu.source === undefined ? {} : { feishuSource: feishu.source }),
    ...(feishu.warning === undefined ? {} : { feishuWarning: feishu.warning }),
    ctx: {
      runId: parsed.data.AW_RUN_ID,
      agentId: parsed.data.AW_AGENT_ID,
      taskId: parsed.data.AW_TASK_ID,
      workspaceRoot: parsed.data.AW_WORKSPACE_ROOT ?? process.cwd(),
      usage: { kind: "unlimited" },
      grants: parseGrants(parsed.data.AW_GRANTS),
    },
  };
}
