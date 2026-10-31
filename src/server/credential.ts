import type { Db } from "../store/database.js";
import { hashSecret, verifySecret } from "../domain/security/secrets.js";

const MIN_PASSWORD_LENGTH = 6;

export interface CredentialInit {
  created: boolean;
}

/** 首次启动把口令哈希写入库;已存在则忽略种子,不再改写。 */
export function ensureConsoleCredential(db: Db, initialPassword?: string): CredentialInit {
  const existing = db.prepare("SELECT 1 FROM console_credential WHERE id = 1").get();
  if (existing !== undefined) {
    return { created: false };
  }
  if (initialPassword === undefined || initialPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `首次启动需设置 CONSOLE_INIT_PASSWORD(至少 ${MIN_PASSWORD_LENGTH} 位),仅用于把口令哈希写入库中;初始化后可留空`,
    );
  }
  const now = Date.now();
  db.prepare(
    "INSERT INTO console_credential (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)",
  ).run(hashSecret(initialPassword), now, now);
  return { created: true };
}

export function verifyConsolePassword(db: Db, password: string): boolean {
  const row = db
    .prepare("SELECT password_hash FROM console_credential WHERE id = 1")
    .get() as { password_hash: string } | undefined;
  if (row === undefined) {
    return false;
  }
  return verifySecret(password, row.password_hash);
}
