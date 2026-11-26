import { api, newIdempotencyKey } from "./client.js";

export type SettingsValueMap = Record<string, string | boolean>;

export interface SettingsResponse {
  values: SettingsValueMap;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface SettingsUpdateResult {
  ok: boolean;
  restartRequired: boolean;
}

export interface SettingsUpdateBody {
  publicUrl?: string;
  consoleAllowedHosts?: string;
  taskZombieHours?: number;
  assignmentStallHours?: number;
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuAllowedOpenIds?: string;
  feishuApprovalChatId?: string;
  feishuCollabChatId?: string;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
  githubWebhookSecret?: string;
}

export function getSettings(): Promise<SettingsResponse> {
  return api.get<SettingsResponse>("/api/settings");
}

export function updateSettings(body: SettingsUpdateBody): Promise<SettingsUpdateResult> {
  return api.put<SettingsUpdateResult>("/api/settings", body, { idempotencyKey: newIdempotencyKey() });
}
