import type { UsageState } from "../capability/gate.js";
import { startOfLocalDay } from "../../shared/time.js";
import type { Db } from "../../store/database.js";
import { findUsageLimitByAgentId } from "../../store/repositories/usage-limit.js";
import { sumAgentTokensSince } from "../../store/repositories/token-usage.js";

export interface UsageResolver {
  resolve(db: Db, agentId: string): Promise<UsageState>;
}

export interface UsageResolverDeps {
  now?: () => number;
}

/**
 * 按 Agent 实时解析当日用量状态(02 §3.6 / 05 §6.3):
 * - 无上限行或已停用 → unlimited
 * - 读取今日用量失败 → unavailable(fail-closed)
 * - 正常 → metered{usedTokens, dailyLimit}
 */
export function createUsageResolver(deps: UsageResolverDeps = {}): UsageResolver {
  const now = deps.now ?? Date.now;

  return {
    async resolve(db: Db, agentId: string): Promise<UsageState> {
      try {
        const limit = await findUsageLimitByAgentId(db, agentId);
        if (limit === undefined || !limit.isActive) {
          return { kind: "unlimited" };
        }
        const since = startOfLocalDay(now());
        const usedTokens = await sumAgentTokensSince(db, agentId, since);
        return {
          kind: "metered",
          usedTokens,
          dailyLimit: limit.dailyTokenLimit,
          hardStop: limit.hardStop,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { kind: "unavailable", reason };
      }
    },
  };
}
