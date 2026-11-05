import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../../store/database.js";
import { ONE_TIME_TOKEN } from "../../shared/constants.js";

export type OneTimeTokenPurpose = "bootstrap_admin" | "enroll";

export interface IssueTokenInput {
  purpose: OneTimeTokenPurpose;
  ttlMs: number;
  now?: () => number;
}

export interface IssuedToken {
  /** 明文令牌,只在签发/兑换响应出现一次,不落日志 */
  token: string;
  expiresAt: number;
}

export interface ConsumeTokenInput {
  purpose: OneTimeTokenPurpose;
  token: string;
  now?: () => number;
}

/** expired 语义为「已过期或已消费」:两者对调用方同为 410,不额外区分 */
export type ConsumeResult = { ok: true } | { ok: false; reason: "invalid" | "expired" };

/** 256 位随机量;SHA-256 定位哈希足够(无字典攻击面,不需要慢哈希) */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintTokenValue(): string {
  return `${ONE_TIME_TOKEN.prefix}${randomBytes(32).toString("base64url")}`;
}

/** 签发一次性令牌:明文只在返回值出现,库中只存哈希、TTL 与消费状态 */
export async function issueOneTimeToken(db: Db, input: IssueTokenInput): Promise<IssuedToken> {
  const now = (input.now ?? Date.now)();
  const token = mintTokenValue();
  const expiresAt = now + input.ttlMs;
  await db.run(
    "INSERT INTO one_time_token (token_hash, purpose, expires_at, created_at) VALUES (?, ?, ?, ?)",
    hashToken(token), input.purpose, expiresAt, now,
  );
  return { token, expiresAt };
}

/**
 * 原子消费:UPDATE ... WHERE consumed_at IS NULL AND expires_at > now,
 * changes = 1 才算赢得令牌,并发双花只有一个成功。
 * 失败后回查区分 invalid(无此令牌,401)与 expired/consumed(410)。
 */
export async function consumeOneTimeToken(db: Db, input: ConsumeTokenInput): Promise<ConsumeResult> {
  const now = (input.now ?? Date.now)();
  const changes = await db.run(
    "UPDATE one_time_token SET consumed_at = ? WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?",
    now, hashToken(input.token), input.purpose, now,
  );
  if (changes.changes === 1) {
    return { ok: true };
  }
  const row = await db.get(
    "SELECT 1 AS one FROM one_time_token WHERE token_hash = ? AND purpose = ?",
    hashToken(input.token), input.purpose,
  );
  return { ok: false, reason: row === undefined ? "invalid" : "expired" };
}
