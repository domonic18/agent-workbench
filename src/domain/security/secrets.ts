import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/**
 * 异步 scrypt:算力走 libuv 线程池,不占事件循环。
 * 口令校验在每次登录、每次 Agent 鉴权时都要跑,同步版本一次就把整个进程卡住约百毫秒,
 * 几个并发请求就能让控制台对外无响应。
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}

/** 自描述哈希格式:scrypt$N$r$p$saltHex$hashHex;参数随值存放,换参数不破坏旧值 */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(secret, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
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
    const actual = await scryptAsync(secret, Buffer.from(saltHex, "hex"), expected.length, {
      N,
      r,
      p,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 明文只在注册/轮换响应出现一次;256 位随机量,base64url 无分隔符 */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}
