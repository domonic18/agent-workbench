import type { Db } from "../store/database.js";
import { hashSecret, verifySecret } from "../domain/security/secrets.js";

const MIN_PASSWORD_LENGTH = 6;

export interface CredentialInit {
  created: boolean;
}

/** 首次启动把口令哈希写入库;已存在则忽略种子,不再改写。 */
export function ensureConsoleCredential(db: Db, initialPassword?: string): Promise<CredentialInit>{
  const existing = await db.get("SELECT 1 FROM console_credential WHERE id = 1");
  if (existing !== undefined) {
    return { created: false };
  }
  if (initialPassword === undefined || initialPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `首次启动需设置 CONSOLE_INIT_PASSWORD(至少 ${MIN_PASSWORD_LENGTH} 位),仅用于把口令哈希写入库中;初始化后可留空`,
    );
  }
  const now = Date.now();
  await db.run(
    "INSERT INTO console_credential (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)",
    hashSecret(initialPassword), now, now);
  return { created: true };
}

export async function verifyConsolePassword(db: Db, password: string): Promise<boolean> {
  const row = await db.get("SELECT password_hash FROM console_credential WHERE id = 1") as { password_hash: string } | undefined;
  if (row === undefined) {
    return false;
  }
  return verifySecret(password, row.password_hash);
}
