import type { Db } from "../../store/database.js";
import { findAgentById, type AgentRecord } from "../../store/repositories/agent.js";
import { upsertUsageLimit } from "../../store/repositories/usage-limit.js";
import { IdentityError } from "./errors.js";

export interface UsageLimitInput {
  dailyTokenLimit: number;
  warnPercent?: number | undefined;
  hardStop?: boolean | undefined;
  isActive?: boolean | undefined;
}

export interface UsageLimitDeps {
  db: Db;
  now?: () => number;
}

/**
 * 控制台维护 Agent 日 token 上限(01 §5):无上限行时默认无限量。
 * 与身份注册分开放,免得身份模块越滚越大。
 */
export async function setUsageLimit(
  deps: UsageLimitDeps,
  id: string,
  input: UsageLimitInput,
): Promise<AgentRecord> {
  const db = deps.db;
  const now = deps.now ?? Date.now;
  if ((await findAgentById(db, id)) === undefined) {
    throw new IdentityError("NOT_FOUND", `Agent ${id} 未注册`);
  }
  if (!Number.isInteger(input.dailyTokenLimit) || input.dailyTokenLimit < 0) {
    throw new IdentityError("VALIDATION_FAILED", "dailyTokenLimit 必须是非负整数");
  }
  const warnPercent = input.warnPercent ?? 80;
  if (!Number.isInteger(warnPercent) || warnPercent < 0 || warnPercent > 100) {
    throw new IdentityError("VALIDATION_FAILED", "warnPercent 必须是 0~100 的整数");
  }
  await upsertUsageLimit(db, {
    agentId: id,
    dailyTokenLimit: input.dailyTokenLimit,
    warnPercent,
    hardStop: input.hardStop ?? true,
    isActive: input.isActive ?? true,
    updatedAt: now(),
  });
  const agent = await findAgentById(db, id);
  if (agent === undefined) {
    throw new Error(`Agent 更新后读不到记录: ${id}`);
  }
  return agent;
}
