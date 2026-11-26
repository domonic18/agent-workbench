import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SYSTEM_CONFIG_BOOT_KEYS,
  SYSTEM_CONFIG_KEYS,
  type SystemConfigKey,
} from "../../config/env.js";
import type { Db } from "../../store/database.js";
import {
  readSystemConfigEntries,
  writeSystemConfig,
} from "../../store/repositories/system-config.js";
import { requireCsrf, requireIdempotencyKey, requireSession } from "../middleware/session.js";
import { invalidSchema } from "./http.js";

export interface SettingsRoutesOptions {
  db: Db;
  now?: () => number;
}

const SECRET_KEYS = new Set<SystemConfigKey>([
  SYSTEM_CONFIG_KEYS.feishuAppSecret,
  SYSTEM_CONFIG_KEYS.embeddingApiKey,
  SYSTEM_CONFIG_KEYS.githubWebhookSecret,
]);

const settingsUpdateSchema = z.object({
  publicUrl: z.string().max(512).optional(),
  consoleAllowedHosts: z.string().max(2048).optional(),
  taskZombieHours: z.coerce.number().int().min(1).max(168).optional(),
  assignmentStallHours: z.coerce.number().int().min(1).max(720).optional(),
  feishuAppId: z.string().max(128).optional(),
  feishuAppSecret: z.string().max(128).optional(),
  feishuAllowedOpenIds: z.string().max(4096).optional(),
  feishuApprovalChatId: z.string().max(64).optional(),
  feishuCollabChatId: z.string().max(64).optional(),
  embeddingBaseUrl: z.string().max(512).optional(),
  embeddingApiKey: z.string().max(512).optional(),
  embeddingModel: z.string().max(128).optional(),
  githubWebhookSecret: z.string().max(256).optional(),
});

type SettingsUpdateBody = z.infer<typeof settingsUpdateSchema>;

function keysByInput(input: SettingsUpdateBody): SystemConfigKey[] {
  const keys: SystemConfigKey[] = [];
  for (const key of Object.keys(input)) {
    const typed = SYSTEM_CONFIG_KEYS[key as keyof typeof SYSTEM_CONFIG_KEYS];
    if (typed !== undefined) {
      keys.push(typed);
    }
  }
  return keys;
}

function toConfigRows(input: SettingsUpdateBody): { key: SystemConfigKey; value: string }[] {
  const rows: { key: SystemConfigKey; value: string }[] = [];
  const add = (key: SystemConfigKey, value: string | undefined) => {
    if (value === undefined) return;
    // 密钥字段:空串表示「保持不变」;显式 null 才清除,但 zod schema 没接收 null,通过前端传 "" 等价保持
    if (value === "" && SECRET_KEYS.has(key)) {
      return;
    }
    rows.push({ key, value });
  };

  add(SYSTEM_CONFIG_KEYS.publicUrl, input.publicUrl);
  add(SYSTEM_CONFIG_KEYS.consoleAllowedHosts, input.consoleAllowedHosts);
  add(SYSTEM_CONFIG_KEYS.taskZombieHours, input.taskZombieHours?.toString());
  add(SYSTEM_CONFIG_KEYS.assignmentStallHours, input.assignmentStallHours?.toString());
  add(SYSTEM_CONFIG_KEYS.feishuAppId, input.feishuAppId);
  add(SYSTEM_CONFIG_KEYS.feishuAppSecret, input.feishuAppSecret);
  add(SYSTEM_CONFIG_KEYS.feishuAllowedOpenIds, input.feishuAllowedOpenIds);
  add(SYSTEM_CONFIG_KEYS.feishuApprovalChatId, input.feishuApprovalChatId);
  add(SYSTEM_CONFIG_KEYS.feishuCollabChatId, input.feishuCollabChatId);
  add(SYSTEM_CONFIG_KEYS.embeddingBaseUrl, input.embeddingBaseUrl);
  add(SYSTEM_CONFIG_KEYS.embeddingApiKey, input.embeddingApiKey);
  add(SYSTEM_CONFIG_KEYS.embeddingModel, input.embeddingModel);
  add(SYSTEM_CONFIG_KEYS.githubWebhookSecret, input.githubWebhookSecret);

  return rows;
}

function maskValues(rows: { key: SystemConfigKey; value: string }[]): Record<SystemConfigKey, string | boolean> {
  const result = {} as Record<SystemConfigKey, string | boolean>;
  for (const row of rows) {
    result[row.key] = SECRET_KEYS.has(row.key) ? true : row.value;
  }
  return result;
}

function detectRestartRequired(keys: SystemConfigKey[]): boolean {
  return keys.some((key) => (SYSTEM_CONFIG_BOOT_KEYS as readonly string[]).includes(key));
}

export function registerSettingsRoutes(app: FastifyInstance, options: SettingsRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;

  app.get(
    "/api/settings",
    { preHandler: [requireSession(db, now)] },
    async () => {
      const entries = await readSystemConfigEntries(db);
      const values = maskValues(
        entries.map((e) => ({ key: e.key as SystemConfigKey, value: e.value })),
      );
      return {
        values,
        updatedAt: entries[0]?.updatedAt ?? null,
        updatedBy: entries[0]?.updatedBy ?? null,
      };
    },
  );

  app.put(
    "/api/settings",
    { preHandler: [requireSession(db, now), requireCsrf(), requireIdempotencyKey()] },
    async (request, reply) => {
      const parsed = settingsUpdateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidSchema(reply, parsed.error);
      }
      const input = parsed.data;
      const affectedKeys = keysByInput(input);
      if (affectedKeys.length === 0) {
        return { ok: true, restartRequired: false };
      }

      const rows = toConfigRows(input);
      if (rows.length > 0) {
        await writeSystemConfig(db, rows, now(), "admin");
      }

      return {
        ok: true,
        restartRequired: detectRestartRequired(affectedKeys),
      };
    },
  );
}
