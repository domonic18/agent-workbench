import type { ToolLevel, ToolVerdict } from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface NewToolCallLog {
  runId: string;
  agentId: string;
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

/** append-only:触发器拒绝 UPDATE/DELETE,这里只提供 INSERT */
export function insertToolCallLog(db: Db, entry: NewToolCallLog): void {
  db.prepare(
    `INSERT INTO tool_call_log
       (run_id, agent_id, task_id, tool, args_hash, level, verdict, reason,
        capability_id, duration_ms, occurred_at)
     VALUES
       (@runId, @agentId, @taskId, @tool, @argsHash, @level, @verdict, @reason,
        @capabilityId, @durationMs, @occurredAt)`,
  ).run(entry);
}
