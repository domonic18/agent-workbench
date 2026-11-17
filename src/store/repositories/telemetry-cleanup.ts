import { TELEMETRY } from "../../shared/constants.js";
import type { Db } from "../database.js";

/**
 * 遥测清理仓储(02 §9):时间线滚动删除、用量明细聚合进日表、孤立 run 剪枝。
 *
 * 删除一律按批推进(每批 ≤ TELEMETRY.sweepBatchMax 行,单语句自动提交),
 * 遵守 02 §5「单事务不超过 1000 行」的纪律——无界 DELETE 持长锁,
 * 2026-11-17 曾把控制台全部写事务堵死两小时。
 * 「聚合 + 删除」用同一条数据修改型 CTE 保证原子:批内行要么聚加并删除,
 * 要么都不发生;删过的行不再参与,重入不会重复计数。
 */

export interface TokenUsageRollupResult {
  /** 本次运行聚合写过的日行数(按 agent×task×source×provider×model×天 去重) */
  groups: number;
}

/**
 * 用量明细滚动聚合:cutoff(UTC 整天零点)之前的明细按
 * (agent, task, source, provider, model, 天) 加总进 token_usage_daily 后删除。
 */
export async function rollupTokenUsageBefore(
  db: Db,
  cutoff: number,
  now: number,
  batchMax: number = TELEMETRY.sweepBatchMax,
): Promise<TokenUsageRollupResult> {
  for (;;) {
    // 无行可聚时 INSERT 写出 0 行,循环终止;每轮至多消耗 batchMax 行明细
    const changes = (
      await db.run(
        `WITH doomed AS (
           DELETE FROM token_usage
            WHERE id IN (
              SELECT id FROM token_usage WHERE occurred_at < ? ORDER BY occurred_at, id LIMIT ?
            )
            RETURNING agent_id, COALESCE(task_id, '') AS task_id, source, provider, model,
                      occurred_at, input_tokens, output_tokens, cache_read_tokens,
                      cache_creation_tokens
         )
         INSERT INTO token_usage_daily
           (agent_id, task_id, source, provider, model, day,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, entries, updated_at)
         SELECT agent_id, task_id, source, provider, model,
                to_char(to_timestamp(occurred_at / 1000) AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
                SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens),
                SUM(cache_creation_tokens), COUNT(*), ?
           FROM doomed
          GROUP BY 1, 2, 3, 4, 5, 6
         ON CONFLICT (agent_id, task_id, source, provider, model, day) DO UPDATE SET
            input_tokens = token_usage_daily.input_tokens + EXCLUDED.input_tokens,
            output_tokens = token_usage_daily.output_tokens + EXCLUDED.output_tokens,
            cache_read_tokens = token_usage_daily.cache_read_tokens + EXCLUDED.cache_read_tokens,
            cache_creation_tokens =
              token_usage_daily.cache_creation_tokens + EXCLUDED.cache_creation_tokens,
            entries = token_usage_daily.entries + EXCLUDED.entries,
            updated_at = EXCLUDED.updated_at`,
        cutoff,
        batchMax,
        now,
      )
    ).changes;
    if (changes === 0) {
      // ON CONFLICT 的更新也计入 rowCount,不算组数;以本次运行写过的时间戳计
      const row = (await db.get(
        "SELECT COUNT(*) AS n FROM token_usage_daily WHERE updated_at = ?",
        now,
      )) as { n: number };
      return { groups: Number(row.n) };
    }
  }
}

/** timeline_event 按入库时刻滚动删除;返回删除行数 */
export async function deleteTimelineEventsIngestedBefore(
  db: Db,
  cutoff: number,
  batchMax: number = TELEMETRY.sweepBatchMax,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const changes = (
      await db.run(
        `DELETE FROM timeline_event WHERE id IN (
           SELECT id FROM timeline_event WHERE ingested_at < ? ORDER BY ingested_at, id LIMIT ?
         )`,
        cutoff,
        batchMax,
      )
    ).changes;
    deleted += changes;
    if (changes < batchMax) {
      return deleted;
    }
  }
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
 *  - 已结束(ended_at not null)且 ended_at 早于 cutoff(与遥测窗口对齐);
 *  - 没有 timeline_event 子行;
 *  - 没有 token_usage 子行。
 */
export async function pruneOrphanRuns(
  db: Db,
  cutoff: number,
  batchMax: number = TELEMETRY.sweepBatchMax,
): Promise<PruneOrphanRunsResult> {
  let deleted = 0;
  for (;;) {
    const changes = (
      await db.run(
        `DELETE FROM agent_run WHERE id IN (
           SELECT id FROM agent_run
            WHERE ended_at IS NOT NULL AND ended_at < ?
              AND NOT EXISTS (SELECT 1 FROM timeline_event t WHERE t.run_id = agent_run.id)
              AND NOT EXISTS (SELECT 1 FROM token_usage u WHERE u.run_id = agent_run.id)
            LIMIT ?
         )`,
        cutoff,
        batchMax,
      )
    ).changes;
    deleted += changes;
    if (changes < batchMax) {
      return { deleted };
    }
  }
}
