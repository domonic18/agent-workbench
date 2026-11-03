import { SYNTHETIC_MODEL } from "../../shared/constants.js";
import { newPrefixedId } from "../../shared/ids.js";
import type { Db } from "../../store/database.js";
import { findRunById } from "../../store/repositories/run.js";
import { findTaskById } from "../../store/repositories/task.js";
import {
  findTokenUsageByKey,
  insertTokenUsage,
  setTaskTotalTokens,
  sumTaskTokens,
} from "../../store/repositories/token-usage.js";
import { TokenUsageError } from "./errors.js";

export interface TokenUsageInput {
  agentId: string;
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

export type RecordTokenUsageResult =
  | { status: "recorded" | "duplicate"; id: string; taskId: string | null }
  | { status: "skipped"; reason: "synthetic" };

export interface TokenUsageService {
  record(input: TokenUsageInput): RecordTokenUsageResult;
  /** 按 token_usage 重算 task.total_tokens;修复用,正常路径在同一事务内增量维护 */
  recomputeTaskTotal(taskId: string): number;
}

export interface TokenUsageServiceDeps {
  db: Db;
  newId?: () => string;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TokenUsageError("VALIDATION_FAILED", `${field} 必须是非空字符串`);
  }
  return value;
}

function requireInteger(value: unknown, field: string, min = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new TokenUsageError("VALIDATION_FAILED", `${field} 必须是 ≥${min} 的整数`);
  }
  return value;
}

export function createTokenUsageService(deps: TokenUsageServiceDeps): TokenUsageService {
  const { db } = deps;
  const newId = deps.newId ?? (() => newPrefixedId("tku"));

  function record(input: TokenUsageInput): RecordTokenUsageResult {
    const model = requireText(input.model, "model");
    if (model.trim() === SYNTHETIC_MODEL) {
      return { status: "skipped", reason: "synthetic" };
    }

    const agentId = requireText(input.agentId, "agentId");
    const runId = requireText(input.runId, "runId");
    const provider = requireText(input.provider, "provider");
    const source = requireText(input.source, "source");
    const receiptHash = requireText(input.receiptHash, "receiptHash");
    const inputTokens = requireInteger(input.inputTokens, "inputTokens");
    const outputTokens = requireInteger(input.outputTokens, "outputTokens");
    const cacheReadTokens = requireInteger(input.cacheReadTokens, "cacheReadTokens");
    const cacheCreationTokens = requireInteger(input.cacheCreationTokens, "cacheCreationTokens");
    const sequence = requireInteger(input.sequence, "sequence");
    const occurredAt = requireInteger(input.occurredAt, "occurredAt", 1);

    return db.transaction((): RecordTokenUsageResult => {
      const run = findRunById(db, runId);
      if (run === undefined) {
        throw new TokenUsageError("NOT_FOUND", `run ${runId} 不存在`);
      }
      if (run.agentId !== agentId) {
        throw new TokenUsageError("VALIDATION_FAILED", "agentId 与 run 归属不一致");
      }

      const existing = findTokenUsageByKey(db, agentId, runId, source, sequence);
      if (existing !== undefined) {
        if (existing.receiptHash !== receiptHash) {
          throw new TokenUsageError("CONFLICT", "同一用量事件带着不同回执哈希,拒绝覆盖");
        }
        return { status: "duplicate", id: existing.id, taskId: existing.taskId };
      }

      const id = newId();
      insertTokenUsage(db, {
        id,
        agentId,
        taskId: run.taskId,
        runId,
        provider,
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        source,
        sequence,
        receiptHash,
        occurredAt,
      });
      if (run.taskId !== null) {
        setTaskTotalTokens(db, run.taskId, sumTaskTokens(db, run.taskId));
      }
      return { status: "recorded", id, taskId: run.taskId };
    });
  }

  function recomputeTaskTotal(taskId: string): number {
    const id = requireText(taskId, "taskId");
    return db.transaction((): number => {
      const task = findTaskById(db, id);
      if (task === undefined) {
        throw new TokenUsageError("NOT_FOUND", `任务 ${id} 不存在`);
      }
      const total = sumTaskTokens(db, id);
      setTaskTotalTokens(db, id, total);
      return total;
    });
  }

  return { record, recomputeTaskTotal };
}
