import type { ToolCallAudit } from "../../shared/audit.js";
import type { Db } from "../database.js";

/** agentId 由服务端按 Bearer 身份注入,不随 proxy 负载传入 */
export interface NewToolCallLog extends ToolCallAudit {
  agentId: string;
}

/** append-only:触发器拒绝 UPDATE/DELETE,这里只提供 INSERT */
export async function insertToolCallLog(db: Db, entry: NewToolCallLog): Promise<void> {
  await db.run(
    `INSERT INTO tool_call_log
       (run_id, agent_id, task_id, tool, args_hash, level, verdict, reason,
        capability_id, duration_ms, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.runId, entry.agentId, entry.taskId, entry.tool, entry.argsHash, entry.level,
    entry.verdict, entry.reason, entry.capabilityId, entry.durationMs, entry.occurredAt,
  );
}
