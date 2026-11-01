import { z } from "zod";
import type { EmbeddingConfig } from "../domain/knowledge/embedding.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_PATH: z.string().min(1).default("./workspace/console.db"),
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
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  // 仅白名单 open_id 可下指令,逗号分隔;空 = 全部拒绝(fail-closed)
  FEISHU_ALLOWED_OPEN_IDS: z.string().optional(),
  // 长连接由应用凭据认证;配置后作为入站消息事件的额外来源校验,留空则跳过
  FEISHU_VERIFICATION_TOKEN: z.string().optional(),
  // 授权审批卡片固定投递的群;留空则不发卡片,改由控制台人工审批
  FEISHU_APPROVAL_CHAT_ID: z.string().optional(),
  // Agent 协作通知群;留空则 a2a_send / task_update 不返回 notify,群通知整体关闭
  FEISHU_COLLAB_CHAT_ID: z.string().optional(),
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
  verificationToken: string | undefined;
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
  databasePath: string;
  knowledgeDir: string;
  embedding: EmbeddingConfig | undefined;
  consoleInitPassword: string | undefined;
  allowedHosts: string[];
  feishu: FeishuConfig | undefined;
  teleport: TeleportConfig;
}

function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseOpenIds(value: string | undefined): string[] {
  const text = optionalText(value);
  if (text === undefined) {
    return [];
  }
  return [...new Set(text.split(",").map((id) => id.trim()).filter((id) => id !== ""))];
}

function parseAllowedHosts(
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
    verificationToken: optionalText(env.FEISHU_VERIFICATION_TOKEN),
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
    databasePath: parsed.data.DATABASE_PATH,
    knowledgeDir: parsed.data.KNOWLEDGE_DIR,
    embedding: parseEmbedding(parsed.data),
    consoleInitPassword:
      initPassword === undefined || initPassword === "" ? undefined : initPassword,
    allowedHosts: parseAllowedHosts(
      parsed.data.CONSOLE_ALLOWED_HOSTS,
      parsed.data.HOST,
      parsed.data.PORT,
    ),
    feishu: parseFeishu(parsed.data),
    teleport: {
      tctlPath: parsed.data.TELEPORT_TCTL_PATH,
      identityFile: optionalText(parsed.data.TELEPORT_IDENTITY_FILE),
      botRole: parsed.data.TELEPORT_BOT_ROLE,
      botMaxSessionTtl: parsed.data.TELEPORT_BOT_MAX_SESSION_TTL,
      auditLogPath: optionalText(parsed.data.TELEPORT_AUDIT_LOG_PATH),
    },
  };
}
