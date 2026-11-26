import { z } from "zod";
import { SYSTEM_CONFIG_KEYS, type SystemConfigKey } from "../shared/constants.js";
import type { EmbeddingConfig } from "../domain/knowledge/embedding.js";

export { SYSTEM_CONFIG_KEYS, type SystemConfigKey };

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_URL: z.string().min(1).default("postgres://agent_workbench@127.0.0.1:5433/agent_workbench"),
  // Markdown 知识条目目录(文本真相源);索引与元数据只是可重建的镜像
  KNOWLEDGE_DIR: z.string().min(1).default("./workspace/knowledge"),
  // OpenAI 兼容嵌入接口;未配齐则只建关键词索引,条目保持 pending
  EMBEDDING_BASE_URL: z.string().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  // 仅首次启动用于把口令哈希写入库;初始化后留空即可
  CONSOLE_INIT_PASSWORD: z.string().optional(),
  // 来源白名单只校验 Host(含端口),逗号分隔;留空 = 本机监听地址
  CONSOLE_ALLOWED_HOSTS: z.string().optional(),
  // 对外可达的控制台地址(公网入口);站点据此给出可复制到别的机器的下载地址
  AW_PUBLIC_URL: z.string().optional(),
  // 置于 TLS 反代之后才置 1:据此采信 X-Forwarded-Proto,会话 Cookie 才会带上 Secure
  AW_TRUST_PROXY: z.string().optional(),
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  // 仅白名单 open_id 可下指令,逗号分隔;空 = 全部拒绝(fail-closed)
  FEISHU_ALLOWED_OPEN_IDS: z.string().optional(),
  // 授权审批卡片固定投递的群;留空则不发卡片,改由控制台人工审批
  FEISHU_APPROVAL_CHAT_ID: z.string().optional(),
  // Agent 协作通知群;留空则 a2a_send / task_update 不返回 notify,群通知整体关闭
  FEISHU_COLLAB_CHAT_ID: z.string().optional(),
  // GitHub Webhook 验签密钥(X-Hub-Signature-256);留空不注册 /api/webhooks/github
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  // 僵尸任务判定时限(M3.10-4):running 且超过该时长未动 → blocked + 按条件重排
  AW_TASK_ZOMBIE_HOURS: z.coerce.number().int().min(1).max(168).default(2),
  // 派工停滞升级时限:assignment pending 超过该时长 → attention=stalled + 播报
  AW_ASSIGNMENT_STALL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  // 授权签发(05 §4):只经 tctl 写入 bot traits,真实证书由 tbot 持有
  TELEPORT_TCTL_PATH: z.string().min(1).default("tctl"),
  TELEPORT_IDENTITY_FILE: z.string().optional(),
  TELEPORT_BOT_ROLE: z.string().min(1).default("aw-ext"),
  TELEPORT_BOT_MAX_SESSION_TTL: z.string().min(1).default("12h"),
  // 审计对账(05 §7):读 Teleport events.log 做 session.start 归因;留空则不对账
  TELEPORT_AUDIT_LOG_PATH: z.string().optional(),
});

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  allowedOpenIds: string[];
  approvalChatId: string | undefined;
  collabChatId: string | undefined;
}

export interface TeleportConfig {
  tctlPath: string;
  identityFile: string | undefined;
  botRole: string;
  botMaxSessionTtl: string;
  auditLogPath: string | undefined;
}

export interface Config {
  nodeEnv: "development" | "test" | "production";
  logLevel: string;
  host: string;
  port: number;
  databaseUrl: string;
  knowledgeDir: string;
  embedding: EmbeddingConfig | undefined;
  consoleInitPassword: string | undefined;
  allowedHosts: string[];
  publicUrl: string | undefined;
  trustProxy: boolean;
  feishu: FeishuConfig | undefined;
  githubWebhookSecret: string | undefined;
  /** 僵尸任务判定时限(毫秒) */
  taskZombieMs: number;
  /** 派工停滞升级时限(毫秒) */
  assignmentStallMs: number;
  teleport: TeleportConfig;
}

function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** 布尔开关:留空为假;取值非法直接报错,避免打错字后静默失效 */
function parseFlag(value: string | undefined, name: string): boolean {
  const text = optionalText(value);
  if (text === undefined) {
    return false;
  }
  const normalized = text.toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  throw new Error(`${name} 只能取 1/0 或 true/false,收到 ${text}`);
}

export function parseOpenIds(value: string | undefined): string[] {
  const text = optionalText(value);
  if (text === undefined) {
    return [];
  }
  return [...new Set(text.split(",").map((id) => id.trim()).filter((id) => id !== ""))];
}

export function parseAllowedHosts(
  value: string | undefined,
  host: string,
  port: number,
): string[] {
  const text = optionalText(value);
  const hosts =
    text === undefined
      ? [`${host}:${port}`, `127.0.0.1:${port}`]
      : text
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter((item) => item !== "");
  const unique = [...new Set(hosts.map((item) => item.toLowerCase()))];
  if (unique.length === 0) {
    throw new Error("CONSOLE_ALLOWED_HOSTS 不能为空");
  }
  return unique;
}

/** 启动组合并:DB 有值覆盖 env;这些项变更后需重启才生效(设置页标注) */
export const SYSTEM_CONFIG_BOOT_KEYS: readonly SystemConfigKey[] = [
  SYSTEM_CONFIG_KEYS.feishuAppId,
  SYSTEM_CONFIG_KEYS.feishuAppSecret,
  SYSTEM_CONFIG_KEYS.feishuApprovalChatId,
  SYSTEM_CONFIG_KEYS.feishuCollabChatId,
  SYSTEM_CONFIG_KEYS.embeddingBaseUrl,
  SYSTEM_CONFIG_KEYS.embeddingApiKey,
  SYSTEM_CONFIG_KEYS.embeddingModel,
  SYSTEM_CONFIG_KEYS.githubWebhookSecret,
];

/** 热读组:DB 有值覆盖 env;路由/作业每轮直读 */
export const SYSTEM_CONFIG_HOT_KEYS: readonly SystemConfigKey[] = [
  SYSTEM_CONFIG_KEYS.publicUrl,
  SYSTEM_CONFIG_KEYS.feishuAllowedOpenIds,
  SYSTEM_CONFIG_KEYS.consoleAllowedHosts,
  SYSTEM_CONFIG_KEYS.taskZombieHours,
  SYSTEM_CONFIG_KEYS.assignmentStallHours,
];

export interface RuntimeConfigOverrides {
  publicUrl?: string;
  allowedHosts?: string[];
  taskZombieHours?: number | undefined;
  assignmentStallHours?: number | undefined;
  feishu?: FeishuConfig | undefined;
  embedding?: EmbeddingConfig | undefined;
  githubWebhookSecret?: string;
}

/** DB 系统配置行合并进 env 启动快照;列表值按当前 env 解析器处理 */
export function mergeRuntimeConfig(
  config: Config,
  rows: Record<string, string>,
): RuntimeConfigOverrides {
  const overrides: RuntimeConfigOverrides = {};

  const publicUrl = optionalText(rows[SYSTEM_CONFIG_KEYS.publicUrl]);
  if (publicUrl !== undefined) {
    overrides.publicUrl = publicUrl;
  }

  const allowedHostsText = optionalText(rows[SYSTEM_CONFIG_KEYS.consoleAllowedHosts]);
  if (allowedHostsText !== undefined) {
    overrides.allowedHosts = parseAllowedHosts(allowedHostsText, config.host, config.port);
  }

  const zombieHours = optionalText(rows[SYSTEM_CONFIG_KEYS.taskZombieHours]);
  const stallHours = optionalText(rows[SYSTEM_CONFIG_KEYS.assignmentStallHours]);
  if (zombieHours !== undefined || stallHours !== undefined) {
    overrides.taskZombieHours = zombieHours === undefined ? undefined : Number(zombieHours);
    overrides.assignmentStallHours = stallHours === undefined ? undefined : Number(stallHours);
  }

  const feishuAppId = optionalText(rows[SYSTEM_CONFIG_KEYS.feishuAppId]);
  const feishuAppSecret = optionalText(rows[SYSTEM_CONFIG_KEYS.feishuAppSecret]);
  if (feishuAppId !== undefined || feishuAppSecret !== undefined) {
    overrides.feishu = {
      appId: feishuAppId ?? config.feishu?.appId ?? "",
      appSecret: feishuAppSecret ?? config.feishu?.appSecret ?? "",
      allowedOpenIds: parseOpenIds(
        optionalText(rows[SYSTEM_CONFIG_KEYS.feishuAllowedOpenIds]) ??
          config.feishu?.allowedOpenIds.join(","),
      ),
      approvalChatId: optionalText(rows[SYSTEM_CONFIG_KEYS.feishuApprovalChatId] ?? config.feishu?.approvalChatId),
      collabChatId: optionalText(rows[SYSTEM_CONFIG_KEYS.feishuCollabChatId] ?? config.feishu?.collabChatId),
    };
  } else if (rows[SYSTEM_CONFIG_KEYS.feishuAllowedOpenIds] !== undefined) {
    // 只迁了白名单,没迁 appId/secret(不太可能,但防御)
    overrides.feishu = config.feishu === undefined ? undefined : {
      ...config.feishu,
      allowedOpenIds: parseOpenIds(rows[SYSTEM_CONFIG_KEYS.feishuAllowedOpenIds]),
      approvalChatId: optionalText(rows[SYSTEM_CONFIG_KEYS.feishuApprovalChatId] ?? config.feishu.approvalChatId),
      collabChatId: optionalText(rows[SYSTEM_CONFIG_KEYS.feishuCollabChatId] ?? config.feishu.collabChatId),
    };
  }

  const embeddingBaseUrl = optionalText(rows[SYSTEM_CONFIG_KEYS.embeddingBaseUrl]);
  const embeddingModel = optionalText(rows[SYSTEM_CONFIG_KEYS.embeddingModel]);
  if (embeddingBaseUrl !== undefined || embeddingModel !== undefined) {
    overrides.embedding = {
      baseUrl: embeddingBaseUrl ?? config.embedding?.baseUrl ?? "",
      apiKey: optionalText(rows[SYSTEM_CONFIG_KEYS.embeddingApiKey] ?? config.embedding?.apiKey),
      model: embeddingModel ?? config.embedding?.model ?? "",
    };
  }

  const githubWebhookSecret = optionalText(rows[SYSTEM_CONFIG_KEYS.githubWebhookSecret]);
  if (githubWebhookSecret !== undefined) {
    overrides.githubWebhookSecret = githubWebhookSecret;
  }

  return overrides;
}

function parseFeishu(env: z.infer<typeof envSchema>): FeishuConfig | undefined {
  const appId = optionalText(env.FEISHU_APP_ID);
  const appSecret = optionalText(env.FEISHU_APP_SECRET);
  if (appId === undefined && appSecret === undefined) {
    return undefined;
  }
  if (appId === undefined || appSecret === undefined) {
    throw new Error("FEISHU_APP_ID 与 FEISHU_APP_SECRET 必须同时设置");
  }
  return {
    appId,
    appSecret,
    allowedOpenIds: parseOpenIds(env.FEISHU_ALLOWED_OPEN_IDS),
    approvalChatId: optionalText(env.FEISHU_APPROVAL_CHAT_ID),
    collabChatId: optionalText(env.FEISHU_COLLAB_CHAT_ID),
  };
}

function parseEmbedding(env: z.infer<typeof envSchema>): EmbeddingConfig | undefined {
  const baseUrl = optionalText(env.EMBEDDING_BASE_URL);
  const model = optionalText(env.EMBEDDING_MODEL);
  if (baseUrl === undefined && model === undefined) {
    return undefined;
  }
  if (baseUrl === undefined || model === undefined) {
    throw new Error("EMBEDDING_BASE_URL 与 EMBEDDING_MODEL 必须同时设置");
  }
  return { baseUrl, apiKey: optionalText(env.EMBEDDING_API_KEY), model };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`环境变量校验失败: ${detail}`);
  }
  const initPassword = parsed.data.CONSOLE_INIT_PASSWORD;
  return {
    nodeEnv: parsed.data.NODE_ENV,
    logLevel: parsed.data.LOG_LEVEL,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    knowledgeDir: parsed.data.KNOWLEDGE_DIR,
    embedding: parseEmbedding(parsed.data),
    consoleInitPassword:
      initPassword === undefined || initPassword === "" ? undefined : initPassword,
    allowedHosts: parseAllowedHosts(
      parsed.data.CONSOLE_ALLOWED_HOSTS,
      parsed.data.HOST,
      parsed.data.PORT,
    ),
    publicUrl: optionalText(parsed.data.AW_PUBLIC_URL),
    trustProxy: parseFlag(parsed.data.AW_TRUST_PROXY, "AW_TRUST_PROXY"),
    feishu: parseFeishu(parsed.data),
    githubWebhookSecret: optionalText(parsed.data.GITHUB_WEBHOOK_SECRET),
    taskZombieMs: parsed.data.AW_TASK_ZOMBIE_HOURS * 3_600_000,
    assignmentStallMs: parsed.data.AW_ASSIGNMENT_STALL_HOURS * 3_600_000,
    teleport: {
      tctlPath: parsed.data.TELEPORT_TCTL_PATH,
      identityFile: optionalText(parsed.data.TELEPORT_IDENTITY_FILE),
      botRole: parsed.data.TELEPORT_BOT_ROLE,
      botMaxSessionTtl: parsed.data.TELEPORT_BOT_MAX_SESSION_TTL,
      auditLogPath: optionalText(parsed.data.TELEPORT_AUDIT_LOG_PATH),
    },
  };
}
