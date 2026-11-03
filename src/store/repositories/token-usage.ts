import type { Db } from "../database.js";

export interface TokenUsageRecord {
  id: string;
  agentId: string;
  taskId: string | null;
  runId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  source: string;
  sequence: number;
  receiptHash: string;
  occurredAt: number;
}

const COLUMNS = `
  id, agent_id AS agentId, task_id AS taskId, run_id AS runId, provider, model,
  input_tokens AS inputTokens, output_tokens AS outputTokens,
  cache_read_tokens AS cacheReadTokens, cache_creation_tokens AS cacheCreationTokens,
  source, sequence, receipt_hash AS receiptHash, occurred_at AS occurredAt
`;

export interface NewTokenUsage {
  id: string;
  agentId: string;
  taskId: string | null;
  runId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  source: string;
  sequence: number;
  receiptHash: string;
  occurredAt: number;
}

export function insertTokenUsage(db: Db, row: NewTokenUsage): void {
  db.prepare(
    `INSERT INTO token_usage
       (id, agent_id, task_id, run_id, provider, model, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, source, sequence, receipt_hash, occurred_at)
     VALUES (@id, @agentId, @taskId, @runId, @provider, @model, @inputTokens, @outputTokens,
             @cacheReadTokens, @cacheCreationTokens, @source, @sequence, @receiptHash, @occurredAt
  ON CONFLICT DO NOTHING)`,
  ).run(row);
}

/** 幂等键 (agent_id, run_id, source, sequence);回执哈希由服务层比较 */
export function findTokenUsageByKey(
  db: Db,
  agentId: string,
  runId: string,
  source: string,
  sequence: number,
): TokenUsageRecord | undefined {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM token_usage
       WHERE agent_id = ? AND run_id = ? AND source = ? AND sequence = ?`,
    )
    .get(agentId, runId, source, sequence) as TokenUsageRecord | undefined;
}

export async function listTokenUsageByRun(db: Db, runId: string): Promise<TokenUsageRecord[]>{
  return await db.all(`SELECT ${COLUMNS} FROM token_usage WHERE run_id = ? ORDER BY sequence ASC, id ASC`, runId) as TokenUsageRecord[];
}

/** 四维之和:总 token 不单独落列,读时按口径计算(02 §3.6) */
export function sumTaskTokens(db: Db, taskId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(
         input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens
       ), 0) AS total FROM token_usage WHERE task_id = ?`,
    )
    .get(taskId) as { total: number };
  return row.total;
}

export interface TaskTokenSummary {
  total: number;
  entries: number;
}

/** 任务详情的用量汇总:四维之和与明细条数,与 token_usage 可对账 */
export function summarizeTaskTokens(db: Db, taskId: string): TaskTokenSummary {
  return db
    .prepare(
      `SELECT COALESCE(SUM(
         input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens
       ), 0) AS total, COUNT(*) AS entries
         FROM token_usage WHERE task_id = ?`,
    )
    .get(taskId) as TaskTokenSummary;
}

export function setTaskTotalTokens(db: Db, taskId: string, total: number): boolean {
  return (
    db.prepare("UPDATE task SET total_tokens = ? WHERE id = ?").run(total, taskId).changes === 1
  );
}
