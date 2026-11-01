import type { A2AIntent } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import type { HandoffNotice } from "../collab/notice.js";

export interface A2aSendInput {
  idempotencyKey: string;
  fromAgentId: string;
  taskId: string;
  to: string;
  intent: A2AIntent;
  summary: string;
  expect: string;
  deadlineAt: number | null;
  refs: string[];
  authTicketId: string | null;
  threadId?: string;
  replyToMsgId?: string;
}

export interface A2aSendResult {
  msgId: string;
  threadId: string;
  round: number;
}

export interface A2aInboxItem {
  msg_id: string;
  thread_id: string;
  task_id: string;
  round: number;
  reply_to: string | null;
  from: string;
  to: string;
  intent: A2AIntent;
  summary: string;
  expect: string;
  deadline: string | null;
  refs: string[];
  auth: { ticket_id: string } | null;
  created_at: number;
}

export interface A2aInboxResult {
  items: A2aInboxItem[];
  nextCursor: string | null;
}

export interface A2aAckInput {
  taskId?: string;
}

export interface A2aService {
  send(input: A2aSendInput): A2aSendResult;
  inbox(agentId: string, opts?: { cursor?: string; waitMs?: number }): Promise<A2aInboxResult>;
  ack(agentId: string, msgId: string, input?: A2aAckInput): void;
  /** 交接通知的渲染元数据;非 request/escalate 或消息/参与方缺失时返回 null */
  handoffNotice(msgId: string): HandoffNotice | null;
  /** 发送落库后唤醒该收件方的长轮询 */
  wake(agentId: string): void;
}

export interface A2aServiceDeps {
  db: Db;
  now?: () => number;
  newMsgId?: () => string;
  newThreadId?: () => string;
  newTaskEventId?: () => string;
  /** 默认长轮询挂起时长,测试可注入短值 */
  waitMs?: number;
}
