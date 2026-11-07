import type { Db } from "../database.js";

export type OneTimeTokenPurpose = "bootstrap_admin" | "enroll" | "agent_enroll";

export interface OneTimeTokenInsert {
  tokenHash: string;
  purpose: OneTimeTokenPurpose;
  /** agent_enroll 专用:令牌只对这一个 Agent 生效;其余用途为空 */
  subjectId?: string | null | undefined;
  expiresAt: number;
  createdAt: number;
}

export async function insertOneTimeToken(db: Db, row: OneTimeTokenInsert): Promise<void> {
  await db.run(
    "INSERT INTO one_time_token (token_hash, purpose, subject_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    row.tokenHash, row.purpose, row.subjectId ?? null, row.expiresAt, row.createdAt,
  );
}

/** 原子消费:changes = 1 才算赢得令牌,并发双花只有一个成功 */
export async function claimOneTimeToken(
  db: Db,
  row: { tokenHash: string; purpose: OneTimeTokenPurpose; now: number },
): Promise<boolean> {
  const changes = await db.run(
    "UPDATE one_time_token SET consumed_at = ? WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?",
    row.now, row.tokenHash, row.purpose, row.now,
  );
  return changes.changes === 1;
}

/** 只看存在性:消费失败后区分 invalid(无此令牌)与 expired(有但已过期/已消费) */
export async function oneTimeTokenExists(
  db: Db,
  row: { tokenHash: string; purpose: OneTimeTokenPurpose },
): Promise<boolean> {
  const found = await db.get(
    "SELECT 1 AS one FROM one_time_token WHERE token_hash = ? AND purpose = ?",
    row.tokenHash, row.purpose,
  );
  return found !== undefined;
}

/** agent_enroll 专用:取令牌绑定的 Agent */
export async function findAgentEnrollSubject(
  db: Db,
  tokenHash: string,
): Promise<string | null> {
  const row = await db.get<{ subjectId: string | null }>(
    "SELECT subject_id AS \"subjectId\" FROM one_time_token WHERE token_hash = ? AND purpose = 'agent_enroll'",
    tokenHash,
  );
  return row?.subjectId ?? null;
}

/**
 * 作废该 Agent 名下尚未消费的接入令牌。
 * 密钥轮换意味着凭据可能已泄露,在途的接入令牌必须一并失效,否则持有者可再次兑换密钥。
 */
export async function voidPendingAgentEnrollTokens(
  db: Db,
  row: { subjectId: string; now: number },
): Promise<number> {
  const changes = await db.run(
    "UPDATE one_time_token SET consumed_at = ? WHERE purpose = 'agent_enroll' AND subject_id = ? AND consumed_at IS NULL",
    row.now, row.subjectId,
  );
  return changes.changes;
}
