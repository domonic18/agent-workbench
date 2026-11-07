import type { ToolLevel, ToolVerdict } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { findCapability } from "../../store/repositories/capability.js";
import { findTaskById } from "../../store/repositories/task.js";
import { insertToolCallLog, type NewToolCallLog } from "../../store/repositories/tool-call-log.js";

/**
 * proxy 上报的审计负载(05 §6.4)。
 * agentId 由服务端按 Bearer 身份注入,不随 proxy 负载传入。
 */
export interface ToolCallPayload {
  runId: string;
  taskId: string;
  tool: string;
  argsHash: string;
  level: ToolLevel;
  verdict: ToolVerdict;
  reason: string | null;
  capabilityId: string | null;
  durationMs: number | null;
  occurredAt: number;
}

export type RecordToolCallErrorCode = "NOT_FOUND" | "FORBIDDEN";

export interface RecordToolCallResult {
  ok: true;
}

export interface RecordToolCallFailure {
  ok: false;
  code: RecordToolCallErrorCode;
  message: string;
}

export interface AuditService {
  recordToolCall(
    agentId: string,
    payload: ToolCallPayload,
  ): Promise<RecordToolCallResult | RecordToolCallFailure>;
}

export interface AuditServiceDeps {
  db: Db;
}

/**
 * 审计写入应用服务:校验任务与授权归属后落库,拒绝伪造他人审计。
 */
export function createAuditService(deps: AuditServiceDeps): AuditService {
  const { db } = deps;
  return {
    async recordToolCall(agentId, payload) {
      const task = await findTaskById(db, payload.taskId);
      if (task === undefined) {
        return {
          ok: false,
          code: "NOT_FOUND",
          message: `任务 ${payload.taskId} 不存在`,
        };
      }
      if (task.assignee !== agentId) {
        return {
          ok: false,
          code: "FORBIDDEN",
          message: `任务 ${payload.taskId} 不属于当前 Agent`,
        };
      }
      const capabilityId = payload.capabilityId;
      if (capabilityId !== null) {
        const capability = await findCapability(db, capabilityId);
        if (capability?.taskId !== task.id) {
          return {
            ok: false,
            code: "FORBIDDEN",
            message: `授权 ${capabilityId} 不属于任务 ${task.id}`,
          };
        }
      }
      const entry: NewToolCallLog = {
        runId: payload.runId,
        agentId,
        taskId: payload.taskId,
        tool: payload.tool,
        argsHash: payload.argsHash,
        level: payload.level,
        verdict: payload.verdict,
        reason: payload.reason,
        capabilityId,
        durationMs: payload.durationMs,
        occurredAt: payload.occurredAt,
      };
      await insertToolCallLog(db, entry);
      return { ok: true };
    },
  };
}
