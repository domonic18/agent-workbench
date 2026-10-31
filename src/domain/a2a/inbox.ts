import { parseJsonStringArray } from "../../store/json.js";
import type { A2aMessageRecord } from "../../store/repositories/a2a.js";
import type { A2aInboxItem } from "./types.js";

export function toInboxItem(row: A2aMessageRecord): A2aInboxItem {
  return {
    msg_id: row.id,
    thread_id: row.threadId,
    task_id: row.taskId,
    round: row.round,
    reply_to: row.replyToMsgId,
    from: row.fromAgent,
    to: row.toAgent,
    intent: row.intent,
    summary: row.summary,
    expect: row.expect,
    deadline: row.deadlineAt === null ? null : new Date(row.deadlineAt).toISOString(),
    refs: parseJsonStringArray(row.refsJson),
    auth: row.authTicket === null ? null : { ticket_id: row.authTicket },
    created_at: row.createdAt,
  };
}
