import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_PATH: z.string().min(1).default("./workspace/console.db"),
  // 仅首次启动用于把口令哈希写入库;初始化后留空即可
  CONSOLE_INIT_PASSWORD: z.string().optional(),
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  // 仅白名单 open_id 可下指令,逗号分隔;空 = 全部拒绝(fail-closed)
  FEISHU_ALLOWED_OPEN_IDS: z.string().optional(),
  // 长连接由应用凭据认证;配置后作为入站消息事件的额外来源校验,留空则跳过
  FEISHU_VERIFICATION_TOKEN: z.string().optional(),
  // 授权审批卡片固定投递的群;留空则不发卡片,改由控制台人工审批
  FEISHU_APPROVAL_CHAT_ID: z.string().optional(),
  // 授权签发(05 §4):只经 tctl 写入 bot traits,真实证书由 tbot 持有
  TELEPORT_TCTL_PATH: z.string().min(1).default("tctl"),
  TELEPORT_IDENTITY_FILE: z.string().optional(),
  TELEPORT_BOT_ROLE: z.string().min(1).default("aw-ext"),
  TELEPORT_BOT_MAX_SESSION_TTL: z.string().min(1).default("12h"),
});

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  allowedOpenIds: string[];
  verificationToken: string | undefined;
  approvalChatId: string | undefined;
}

export interface TeleportConfig {
  tctlPath: string;
  identityFile: string | undefined;
  botRole: string;
  botMaxSessionTtl: string;
}

export interface Config {
  nodeEnv: "development" | "test" | "production";
  logLevel: string;
  host: string;
  port: number;
  databasePath: string;
  consoleInitPassword: string | undefined;
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
  };
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
    consoleInitPassword:
      initPassword === undefined || initPassword === "" ? undefined : initPassword,
    feishu: parseFeishu(parsed.data),
    teleport: {
      tctlPath: parsed.data.TELEPORT_TCTL_PATH,
      identityFile: optionalText(parsed.data.TELEPORT_IDENTITY_FILE),
      botRole: parsed.data.TELEPORT_BOT_ROLE,
      botMaxSessionTtl: parsed.data.TELEPORT_BOT_MAX_SESSION_TTL,
    },
  };
}
