import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../../store/database.js";
import { ONE_TIME_TOKEN } from "../../shared/constants.js";

export type OneTimeTokenPurpose = "bootstrap_admin" | "enroll" | "agent_enroll";

export interface IssueTokenInput {
  purpose: OneTimeTokenPurpose;
  ttlMs: number;
  /** agent_enroll 专用:令牌只对这一个 Agent 生效;其余用途为空 */
  subjectId?: string | undefined;
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
    "INSERT INTO one_time_token (token_hash, purpose, subject_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    hashToken(token), input.purpose, input.subjectId ?? null, expiresAt, now,
  );
  return { token, expiresAt };
}

/**
 * 原子消费:UPDATE ... WHERE consumed_at IS NULL AND expires_at > now,
 * changes = 1 才算赢得令牌,并发双花只有一个成功。
 */
async function claimToken(
  db: Db,
  hash: string,
  purpose: OneTimeTokenPurpose,
  now: number,
): Promise<boolean> {
  const changes = await db.run(
    "UPDATE one_time_token SET consumed_at = ? WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?",
    now, hash, purpose, now,
  );
  return changes.changes === 1;
}

/**
 * 消费一次性令牌。失败后回查区分 invalid(无此令牌,401)与 expired/consumed(410)。
 */
export async function consumeOneTimeToken(db: Db, input: ConsumeTokenInput): Promise<ConsumeResult> {
  const now = (input.now ?? Date.now)();
  const hash = hashToken(input.token);
  if (await claimToken(db, hash, input.purpose, now)) {
    return { ok: true };
  }
  const row = await db.get(
    "SELECT 1 AS one FROM one_time_token WHERE token_hash = ? AND purpose = ?",
    hash, input.purpose,
  );
  return { ok: false, reason: row === undefined ? "invalid" : "expired" };
}

export type AgentEnrollConsumeResult =
  | { ok: true; agentId: string }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * 兑换 Agent 接入令牌:先定位令牌绑定的 Agent,再原子消费。
 * 与 consumeOneTimeToken 分开——它不返回令牌主体,调用方需要知道该给谁换密钥。
 */
export async function consumeAgentEnrollToken(
  db: Db,
  input: { token: string; now?: () => number },
): Promise<AgentEnrollConsumeResult> {
  const now = (input.now ?? Date.now)();
  const hash = hashToken(input.token);
  const row = await db.get<{ subjectId: string | null }>(
    "SELECT subject_id AS \"subjectId\" FROM one_time_token WHERE token_hash = ? AND purpose = 'agent_enroll'",
    hash,
  );
  if (row === undefined || row.subjectId === null || row.subjectId === "") {
    return { ok: false, reason: "invalid" };
  }
  if (!(await claimToken(db, hash, "agent_enroll", now))) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, agentId: row.subjectId };
}
