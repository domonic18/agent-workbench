import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** 自描述哈希格式:scrypt$N$r$p$saltHex$hashHex;参数随值存放,换参数不破坏旧值 */
export function hashSecret(secret: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(secret, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split("$");
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
    const actual = scryptSync(secret, Buffer.from(saltHex, "hex"), expected.length, { N, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 明文只在注册/轮换响应出现一次;256 位随机量,base64url 无分隔符 */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}
