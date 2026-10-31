import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "../store/database.js";

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MIN_PASSWORD_LENGTH = 6;

export interface CredentialInit {
  created: boolean;
}

function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
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
  ).run(hashPassword(initialPassword), now, now);
  return { created: true };
}

export function verifyConsolePassword(db: Db, password: string): boolean {
  const row = db
    .prepare("SELECT password_hash FROM console_credential WHERE id = 1")
    .get() as { password_hash: string } | undefined;
  if (row === undefined) {
    return false;
  }

  const parts = row.password_hash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const [, nText = "", rText = "", pText = "", saltHex = "", hashHex = ""] = parts;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (
    ![N, r, p].every((value) => Number.isInteger(value) && value > 0) ||
    N > 1_048_576 ||
    !/^[0-9a-f]+$/i.test(saltHex) ||
    !/^[0-9a-f]+$/i.test(hashHex)
  ) {
    return false;
  }

  const expected = Buffer.from(hashHex, "hex");
  try {
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
