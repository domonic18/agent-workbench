import { api, newIdempotencyKey } from "./client.js";

export function login(password: string): Promise<unknown> {
  return api.post("/api/auth/login", { password });
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
