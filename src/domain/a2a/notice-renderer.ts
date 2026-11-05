import { findAgentById, type AgentRecord } from "../../store/repositories/identity.js";
import { findTaskById } from "../../store/repositories/task.js";
import {
  findMessageById,
  type A2aMessageRecord,
} from "../../store/repositories/a2a.js";
import type { AcceptNotice, CollabAgentRef, HandoffNotice } from "../collab/notice.js";

export function agentRef(agent: AgentRecord): CollabAgentRef {
  return { id: agent.id, displayName: agent.displayName };
}

function isRequestLike(message: A2aMessageRecord): boolean {
  return message.intent === "request" || message.intent === "escalate";
}

/** 交接通知的渲染元数据;非 request/escalate、未 ack 或参与方缺失时返回 null */
export async function createHandoffNotice(
  db: Parameters<typeof findMessageById>[0],
  msgId: string,
): Promise<HandoffNotice | null> {
  const message = await findMessageById(db, msgId);
  if (message === undefined || !isRequestLike(message)) {
    return null;
  }
  const from = await findAgentById(db, message.fromAgent);
  const to = await findAgentById(db, message.toAgent);
  if (from === undefined || to === undefined) {
    return null;
  }
  return {
    msgId: message.id,
    taskId: message.taskId,
    summary: message.summary,
    from: agentRef(from),
    to: agentRef(to),
  };
}

/** 接单播报的渲染元数据;非 request/escalate、未 ack 或参与方缺失时返回 null */
export async function createAcceptNotice(
  db: Parameters<typeof findMessageById>[0],
  msgId: string,
  childTaskId?: string,
): Promise<AcceptNotice | null> {
  const message = await findMessageById(db, msgId);
  if (message === undefined || message.ackAt === null || !isRequestLike(message)) {
    return null;
  }
  const from = await findAgentById(db, message.fromAgent);
  const to = await findAgentById(db, message.toAgent);
  if (from === undefined || to === undefined) {
    return null;
  }
  const root = await findTaskById(db, message.taskId);
  if (root === undefined) {
    return null;
  }
  const child = childTaskId === undefined ? undefined : await findTaskById(db, childTaskId);
  return {
    msgId: message.id,
    taskId: child?.id ?? message.taskId,
    title: child?.title ?? root.title,
    from: agentRef(from),
    to: agentRef(to),
  };
}
