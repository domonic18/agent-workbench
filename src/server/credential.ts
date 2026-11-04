import type { Db } from "../store/database.js";
import { hashSecret, verifySecret } from "../domain/security/secrets.js";

export const MIN_PASSWORD_LENGTH = 6;

export interface CredentialInit {
  created: boolean;
}

/** 首次启动把口令哈希写入库;已存在则忽略种子,不再改写。
 *  无种子且库中无凭据时不抛错——进入 bootstrap mode(01 §2),
 *  由调用方检查 hasConsoleCredential 决定是否签发一次性 bootstrap_admin token。 */
export async function ensureConsoleCredential(db: Db, initialPassword?: string): Promise<CredentialInit> {
  const existing = await db.get("SELECT 1 FROM console_credential WHERE id = 1");
  if (existing !== undefined) {
    return { created: false };
  }
  if (initialPassword === undefined || initialPassword === "") {
    return { created: false };
  }
  if (initialPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `首次启动需设置 CONSOLE_INIT_PASSWORD(至少 ${MIN_PASSWORD_LENGTH} 位),仅用于把口令哈希写入库中;初始化后可留空`,
    );
  }
  await setConsolePassword(db, initialPassword);
  return { created: true };
}

/** bootstrap mode 判定:库中无凭据即未初始化 */
export async function hasConsoleCredential(db: Db): Promise<boolean> {
  return (await db.get("SELECT 1 FROM console_credential WHERE id = 1")) !== undefined;
}

/** 写入管理员口令哈希;仅 bootstrap mode 首次设置时调用,已存在则违反唯一主键 */
export async function setConsolePassword(db: Db, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`口令至少 ${MIN_PASSWORD_LENGTH} 位`);
  }
  const now = Date.now();
  await db.run(
    "INSERT INTO console_credential (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)",
    hashSecret(password), now, now);
}

export async function verifyConsolePassword(db: Db, password: string): Promise<boolean> {
  const row = await db.get("SELECT password_hash FROM console_credential WHERE id = 1") as { password_hash: string } | undefined;
  if (row === undefined) {
    return false;
  }
  return verifySecret(password, row.password_hash);
}
