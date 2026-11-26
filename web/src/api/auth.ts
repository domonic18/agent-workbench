import { api, newIdempotencyKey } from "./client.js";

export function login(password: string): Promise<unknown> {
  return api.post("/api/auth/login", { password });
}

export interface FeishuStatus {
  enabled: boolean;
  appId: string;
}

export function feishuStatus(): Promise<FeishuStatus> {
  return api.get<FeishuStatus>("/api/auth/feishu/status");
}

/** 飞书免登:code 由 JSAPI 取得,服务端校验白名单后发会话 */
export function feishuLogin(code: string): Promise<{ ok: boolean; expiresAt: number }> {
  return api.post<{ ok: boolean; expiresAt: number }>("/api/auth/feishu/login", { code });
}

export function logout(): Promise<unknown> {
  return api.post("/api/auth/logout");
}

export interface PasswordChangeResult {
  ok: boolean;
  /** 被吊销的其他设备会话数;发起改动的这台设备保留 */
  revokedSessions: number;
}

/** 改管理员口令:当前设备保留登录态,其他设备会话被吊销 */
export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<PasswordChangeResult> {
  return api.post<PasswordChangeResult>(
    "/api/auth/password",
    { currentPassword, newPassword },
    { idempotencyKey: newIdempotencyKey() },
  );
}
