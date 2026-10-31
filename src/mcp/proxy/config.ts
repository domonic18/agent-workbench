import { z } from "zod";
import type { Grant, RunContext } from "../../domain/capability/gate.js";
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
  AW_TASK_ID: z.string().min(1),
  AW_WORKSPACE_ROOT: z.string().min(1),
  AW_UPSTREAMS: z.string().min(1),
  AW_GRANTS: z.string().optional(),
  AW_APPROVAL_TIMEOUT_MS: z.coerce.number().int().min(1).optional(),
  DATABASE_PATH: z.string().min(1).default("./workspace/console.db"),
});

export interface ProxyConfig {
  databasePath: string;
  approvalTimeoutMs: number | undefined;
  upstreams: UpstreamConfig[];
  toolMap: Record<string, Record<string, string>>;
  ctx: RunContext;
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
  const parsed = z.array(upstreamSchema).min(1).safeParse(decoded);
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
  const toolMap: Record<string, Record<string, string>> = {};
  for (const entry of entries) {
    if (entry.toolMap !== undefined) {
      toolMap[entry.id] = entry.toolMap;
    }
  }

  return {
    databasePath: parsed.data.DATABASE_PATH,
    approvalTimeoutMs: parsed.data.AW_APPROVAL_TIMEOUT_MS,
    upstreams: entries.map((entry) => ({
      id: entry.id,
      command: entry.command,
      args: entry.args,
      ...(entry.env === undefined ? {} : { env: entry.env }),
    })),
    toolMap,
    ctx: {
      runId: parsed.data.AW_RUN_ID,
      agentId: parsed.data.AW_AGENT_ID,
      taskId: parsed.data.AW_TASK_ID,
      workspaceRoot: parsed.data.AW_WORKSPACE_ROOT,
      usage: { kind: "unlimited" },
      grants: parseGrants(parsed.data.AW_GRANTS),
    },
  };
}
