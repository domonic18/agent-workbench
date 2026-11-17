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
  id, agent_id AS "agentId", task_id AS "taskId", run_id AS "runId", provider, model,
  input_tokens AS "inputTokens", output_tokens AS "outputTokens",
  cache_read_tokens AS "cacheReadTokens", cache_creation_tokens AS "cacheCreationTokens",
  source, sequence, receipt_hash AS "receiptHash", occurred_at AS "occurredAt"
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

export async function insertTokenUsage(db: Db, row: NewTokenUsage): Promise<void> {
  await db.run(
    `INSERT INTO token_usage
       (id, agent_id, task_id, run_id, provider, model, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, source, sequence, receipt_hash, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.agentId, row.taskId, row.runId, row.provider, row.model,
    row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheCreationTokens,
    row.source, row.sequence, row.receiptHash, row.occurredAt,
  );
}

/** 幂等键 (agent_id, run_id, source, sequence);回执哈希由服务层比较 */
export async function findTokenUsageByKey(
  db: Db,
  agentId: string,
  runId: string,
  source: string,
  sequence: number,
): Promise<TokenUsageRecord | undefined> {
  return (await db.get(
    `SELECT ${COLUMNS} FROM token_usage
     WHERE agent_id = ? AND run_id = ? AND source = ? AND sequence = ?`,
    agentId, runId, source, sequence,
  )) as TokenUsageRecord | undefined;
}

export async function listTokenUsageByRun(db: Db, runId: string): Promise<TokenUsageRecord[]> {
  return (await db.all(
    `SELECT ${COLUMNS} FROM token_usage WHERE run_id = ? ORDER BY sequence ASC, id ASC`,
    runId,
  )) as TokenUsageRecord[];
}

/** 四维之和:总 token 不单独落列,读时按口径计算(02 §3.6)。
 *  口径走 token_usage_all 冷热视图:明细过期聚合后,任务的长期总量仍准确 */
export async function sumTaskTokens(db: Db, taskId: string): Promise<number> {
  const row = (await db.get(
    `SELECT COALESCE(SUM(
       input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens
     ), 0) AS total FROM token_usage_all WHERE task_id = ?`,
    taskId,
  )) as { total: number };
  return row.total;
}

export interface TaskTokenSummary {
  total: number;
  entries: number;
}

/** 任务详情的用量汇总:四维之和与明细条数,与 token_usage_all 可对账 */
export async function summarizeTaskTokens(db: Db, taskId: string): Promise<TaskTokenSummary> {
  return (await db.get(
    `SELECT COALESCE(SUM(
       input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens
     ), 0) AS total, COALESCE(SUM(entries), 0) AS entries
       FROM token_usage_all WHERE task_id = ?`,
    taskId,
  )) as TaskTokenSummary;
}

/** Agent 从某时刻起的四维用量之和;今日汇总与 overview.ts 同口径 */
export async function sumAgentTokensSince(
  db: Db,
  agentId: string,
  since: number,
): Promise<number> {
  const row = (await db.get(
    `SELECT COALESCE(SUM(
       input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens
     ), 0) AS total FROM token_usage_all WHERE agent_id = ? AND occurred_at >= ?`,
    agentId,
    since,
  )) as { total: number };
  return row.total;
}

export async function setTaskTotalTokens(db: Db, taskId: string, total: number): Promise<boolean> {
  return (
    (await db.run("UPDATE task SET total_tokens = ? WHERE id = ?", total, taskId)).changes === 1
  );
}

export interface TokenUsageRollupResult {
  /** 聚合进 token_usage_daily 的明细行数 */
  aggregated: number;
}

/**
 * 用量明细滚动聚合(02 §3.6):cutoff(取整天零点)之前的明细按
 * (agent, task, source, provider, model, 天) 加总进 token_usage_daily 后删除。
 * 聚合与删除同一事务:中断要么都不发生,要么都完成,不会重复计数。
 * 幂等性由「删过的行不再参与聚合」保证。
 */
export async function rollupTokenUsageBefore(
  db: Db,
  cutoff: number,
  now: number,
): Promise<TokenUsageRollupResult> {
  return db.transaction(async (tx): Promise<TokenUsageRollupResult> => {
    await tx.run(
      `INSERT INTO token_usage_daily
         (agent_id, task_id, source, provider, model, day,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, entries, updated_at)
       SELECT agent_id, COALESCE(task_id, ''), source, provider, model,
              to_char(to_timestamp(occurred_at / 1000) AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
              SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens),
              SUM(cache_creation_tokens), COUNT(*), ?
         FROM token_usage
        WHERE occurred_at < ?
        GROUP BY 1, 2, 3, 4, 5, 6
       ON CONFLICT (agent_id, task_id, source, provider, model, day) DO UPDATE SET
          input_tokens = token_usage_daily.input_tokens + EXCLUDED.input_tokens,
          output_tokens = token_usage_daily.output_tokens + EXCLUDED.output_tokens,
          cache_read_tokens = token_usage_daily.cache_read_tokens + EXCLUDED.cache_read_tokens,
          cache_creation_tokens = token_usage_daily.cache_creation_tokens + EXCLUDED.cache_creation_tokens,
          entries = token_usage_daily.entries + EXCLUDED.entries,
          updated_at = EXCLUDED.updated_at`,
      now,
      cutoff,
    );
    const deleted = (await tx.run("DELETE FROM token_usage WHERE occurred_at < ?", cutoff)).changes;
    return { aggregated: deleted };
  });
}

/** timeline_event 按入库时刻滚动删除;返回删除行数 */
export async function deleteTimelineEventsIngestedBefore(
  db: Db,
  cutoff: number,
): Promise<number> {
  return (await db.run("DELETE FROM timeline_event WHERE ingested_at < ?", cutoff)).changes;
}

export interface PruneOrphanRunsResult {
  deleted: number;
}

/**
 * 清理已无遥测子表的孤立 agent_run。
 *
 * run 存在的意义是承载 timeline_event / token_usage;当它的所有事件与用量
 * 都已被保留策略删除后,run 行本身也成了死元数据,应及时删除。
 * 只删同时满足下列条件的 run,避免误伤有在跑事件或被查看的 run:
 *  - 已结束(ended_at not null);
 *  - 没有 timeline_event 子行;
 *  - 没有 token_usage 子行;
 *  - ended_at 早于 cutoff(与遥测窗口对齐,迟到回填不再打开它的可能性极低)。
 */
export async function pruneOrphanRuns(
  db: Db,
  cutoff: number,
): Promise<PruneOrphanRunsResult> {
  const deleted = (
    await db.run(
      `DELETE FROM agent_run
        WHERE ended_at IS NOT NULL
          AND ended_at < ?
          AND NOT EXISTS (SELECT 1 FROM timeline_event t WHERE t.run_id = agent_run.id)
          AND NOT EXISTS (SELECT 1 FROM token_usage u WHERE u.run_id = agent_run.id)`,
      cutoff,
    )
  ).changes;
  return { deleted };
}
