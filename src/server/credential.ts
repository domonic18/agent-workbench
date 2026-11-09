import { CONSOLE_PASSWORD_MIN_LENGTH } from "../shared/constants.js";
import { hashSecret, verifySecret } from "../domain/security/secrets.js";
import type { Db } from "../store/database.js";

export interface CredentialInit {
  created: boolean;
}

/** 口令长度下限:后端写入与前端表单共用同一处常量,避免两侧各写一个数字 */
function assertPasswordLength(password: string): void {
  if (password.length < CONSOLE_PASSWORD_MIN_LENGTH) {
    throw new Error(`口令至少 ${CONSOLE_PASSWORD_MIN_LENGTH} 位`);
  }
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
  if (initialPassword.length < CONSOLE_PASSWORD_MIN_LENGTH) {
    throw new Error(
      `首次启动需设置 CONSOLE_INIT_PASSWORD(至少 ${CONSOLE_PASSWORD_MIN_LENGTH} 位),仅用于把口令哈希写入库中;初始化后可留空`,
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
  assertPasswordLength(password);
  const now = Date.now();
  await db.run(
    "INSERT INTO console_credential (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)",
    await hashSecret(password), now, now);
}

/**
 * 改写管理员口令哈希。凭据只有一行,这里是 UPDATE 而不是再 INSERT。
 * 会话与口令哈希彼此独立:改口令不动 session 行,不会把在用设备踢下线。
 */
export async function updateConsolePassword(db: Db, password: string): Promise<void> {
  assertPasswordLength(password);
  const now = Date.now();
  const result = await db.run(
    "UPDATE console_credential SET password_hash = ?, updated_at = ? WHERE id = 1",
    await hashSecret(password), now,
  );
  if (result.changes === 0) {
    throw new Error("控制台尚未初始化,无法修改口令");
  }
}

export async function verifyConsolePassword(db: Db, password: string): Promise<boolean> {
  const row = await db.get("SELECT password_hash FROM console_credential WHERE id = 1") as { password_hash: string } | undefined;
  if (row === undefined) {
    return false;
  }
  return await verifySecret(password, row.password_hash);
}
