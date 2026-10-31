import { enqueuePull } from "../../reliability/outbox.js";
import { A2A_INBOX, OUTBOX_TIMEOUTS } from "../../shared/constants.js";
import { formatKeysetCursor, parseKeysetCursor } from "../../shared/cursor.js";
import { newPrefixedId } from "../../shared/ids.js";
import { parseJsonStringArray } from "../../store/json.js";
import {
  findMessageById,
  findThreadById,
  findThreadByInitiator,
  insertMessage,
  insertThread,
  listInbox,
  markAck,
  maxRound,
  type A2aThreadRecord,
} from "../../store/repositories/a2a.js";
import { findAgentById, type AgentRecord } from "../../store/repositories/identity.js";
import {
  claimPullByMsgId,
  findOutboxByKey,
  findUncertainFence,
  markDeliveredByMsgId,
} from "../../store/repositories/outbox.js";
import {
  appendTaskEvent,
  findTaskParent,
  findTaskSummary,
  setTaskParentIfEmpty,
} from "../../store/repositories/task.js";
import { A2aError } from "./errors.js";
import { toInboxItem } from "./inbox.js";
import type {
  A2aAckInput,
  A2aInboxItem,
  A2aInboxResult,
  A2aSendInput,
  A2aSendResult,
  A2aService,
  A2aServiceDeps,
} from "./types.js";

export function createA2aService(deps: A2aServiceDeps): A2aService {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const newMsgId = deps.newMsgId ?? (() => newPrefixedId("msg"));
  const newThreadId = deps.newThreadId ?? (() => newPrefixedId("thr"));
  const newTaskEventId = deps.newTaskEventId ?? (() => newPrefixedId("tev"));
  const defaultWaitMs = deps.waitMs ?? A2A_INBOX.waitMs;

  // 进程内等待者注册表:单进程单实例,长轮询靠 wake 唤醒;跨进程靠轮询兜底
  const waiters = new Map<string, Set<() => void>>();

  function wake(agentId: string): void {
    const set = waiters.get(agentId);
    if (set === undefined) {
      return;
    }
    for (const notify of [...set]) {
      notify();
    }
  }

  function waitForWake(agentId: string, waitMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const set = waiters.get(agentId) ?? new Set<() => void>();
      waiters.set(agentId, set);
      const done = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        set.delete(done);
        if (set.size === 0) {
          waiters.delete(agentId);
        }
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      timer.unref();
      set.add(done);
    });
  }

  function resolveThread(input: A2aSendInput, sender: AgentRecord, at: number): A2aThreadRecord {
    if (input.threadId !== undefined) {
      const thread = findThreadById(db, input.threadId);
      if (thread === undefined) {
        throw new A2aError("NOT_FOUND", `线程 ${input.threadId} 不存在`);
      }
      if (sender.id !== thread.initiatorAgent && sender.id !== thread.responderAgent) {
        throw new A2aError("FORBIDDEN", "调用方不是该线程的参与方");
      }
      const counterpart =
        sender.id === thread.initiatorAgent ? thread.responderAgent : thread.initiatorAgent;
      if (input.to !== counterpart) {
        throw new A2aError("FORBIDDEN", "线程内只能向另一方发送");
      }
      return thread;
    }
    const existing = findThreadByInitiator(db, input.taskId, input.to);
    if (existing !== undefined) {
      return existing;
    }
    const thread: A2aThreadRecord = {
      id: newThreadId(),
      initiatorTaskId: input.taskId,
      initiatorAgent: sender.id,
      responderAgent: input.to,
      createdAt: at,
    };
    insertThread(db, thread);
    return thread;
  }

  function send(input: A2aSendInput): A2aSendResult {
    const existing = findOutboxByKey(db, input.idempotencyKey);
    if (existing !== undefined) {
      if (existing.msgId === null) {
        throw new A2aError("CONFLICT", "幂等键已被非 A2A 出箱行占用");
      }
      const message = findMessageById(db, existing.msgId);
      if (message === undefined) {
        throw new A2aError("CONFLICT", "幂等记录指向的消息不存在");
      }
      return { msgId: message.id, threadId: message.threadId, round: message.round };
    }

    const sender = findAgentById(db, input.fromAgentId);
    if (sender === undefined || sender.status !== "active") {
      throw new A2aError("FORBIDDEN", "发送方未注册或已停用");
    }

    const task = findTaskSummary(db, input.taskId);
    if (task === undefined) {
      throw new A2aError("NOT_FOUND", `任务 ${input.taskId} 不存在`);
    }
    if (task.assignee !== input.fromAgentId) {
      throw new A2aError("FORBIDDEN", "只能以自己的任务发起 A2A");
    }

    const target = findAgentById(db, input.to);
    if (target === undefined || target.status !== "active") {
      throw new A2aError("NOT_FOUND", `目标 Agent ${input.to} 不存在或已停用`);
    }
    if (!parseJsonStringArray(sender.allowedTargetsJson).includes(input.to)) {
      throw new A2aError("FORBIDDEN", `目标 Agent ${input.to} 不在委派白名单内`);
    }

    if (findUncertainFence(db, input.taskId)) {
      throw new A2aError("CONFLICT", "该任务存在结果未知的投递,已冻结新的 A2A 发送");
    }

    const at = now();
    const msgId = newMsgId();

    const result = db.transaction((): A2aSendResult => {
      const thread = resolveThread(input, sender, at);
      if (input.replyToMsgId !== undefined) {
        const referenced = findMessageById(db, input.replyToMsgId);
        if (referenced === undefined || referenced.threadId !== thread.id) {
          throw new A2aError("VALIDATION_FAILED", "reply_to 必须是同一线程内的消息");
        }
      }
      const round = maxRound(db, thread.id) + 1;
      insertMessage(db, {
        id: msgId,
        threadId: thread.id,
        taskId: input.taskId,
        round,
        replyToMsgId: input.replyToMsgId ?? null,
        fromAgent: sender.id,
        toAgent: input.to,
        intent: input.intent,
        summary: input.summary,
        expect: input.expect,
        deadlineAt: input.deadlineAt,
        refsJson: JSON.stringify(input.refs),
        authTicket: input.authTicketId,
        createdAt: at,
      });
      const row = findMessageById(db, msgId);
      if (row === undefined) {
        throw new Error(`A2A 消息落库后读不到: ${msgId}`);
      }
      const outbox = enqueuePull(db, {
        idempotencyKey: input.idempotencyKey,
        kind: "a2a_message",
        taskId: input.taskId,
        msgId,
        payloadJson: JSON.stringify(toInboxItem(row)),
        now: at,
      });
      // 并发下同一幂等键可能已被另一条消息抢先入队;回滚本次写入,不留下无法投递的孤儿消息
      if (outbox.msgId !== msgId) {
        throw new A2aError("CONFLICT", "幂等键已被另一条 A2A 消息占用");
      }
      return { msgId, threadId: thread.id, round };
    })();

    wake(input.to);
    return result;
  }

  function takeVisible(
    agentId: string,
    after: { createdAt: number; id: string } | undefined,
  ): A2aInboxResult {
    const at = now();
    const rows = listInbox(db, agentId, {
      now: at,
      limit: A2A_INBOX.pageSize,
      ...(after === undefined ? {} : { after }),
    });
    const leaseUntil = at + OUTBOX_TIMEOUTS.leaseMs;
    const items: A2aInboxItem[] = [];
    for (const row of rows) {
      // 领取失败说明已被另一次拉取拿走;本条跳过,等租约回收后重新可见
      if (claimPullByMsgId(db, row.id, at, leaseUntil) === undefined) {
        continue;
      }
      items.push(toInboxItem(row));
    }
    const last = rows.at(-1);
    return {
      items,
      nextCursor:
        rows.length === A2A_INBOX.pageSize && last !== undefined
          ? formatKeysetCursor(last)
          : null,
    };
  }

  async function inbox(
    agentId: string,
    opts: { cursor?: string; waitMs?: number } = {},
  ): Promise<A2aInboxResult> {
    const after = opts.cursor === undefined ? undefined : parseKeysetCursor(opts.cursor);
    if (opts.cursor !== undefined && after === undefined) {
      throw new A2aError("VALIDATION_FAILED", "cursor 格式应为 <createdAt>:<id>");
    }
    const requested = opts.waitMs ?? defaultWaitMs;
    const waitMs = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), A2A_INBOX.maxWaitMs) : defaultWaitMs;

    const first = takeVisible(agentId, after);
    if (first.items.length > 0 || waitMs === 0) {
      return first;
    }
    await waitForWake(agentId, waitMs);
    return takeVisible(agentId, after);
  }

  function ack(agentId: string, msgId: string, input: A2aAckInput = {}): void {
    const at = now();
    db.transaction(() => {
      const message = findMessageById(db, msgId);
      if (message === undefined) {
        throw new A2aError("NOT_FOUND", `消息 ${msgId} 不存在`);
      }
      if (message.toAgent !== agentId) {
        throw new A2aError("FORBIDDEN", "只能 ACK 发给自己的消息");
      }
      if (message.ackAt !== null) {
        return;
      }
      if (message.intent === "request" || message.intent === "escalate") {
        const taskId = input.taskId?.trim();
        if (taskId === undefined || taskId === "") {
          throw new A2aError(
            "VALIDATION_FAILED",
            "ACK request/escalate 必须携带自己承接的 task_id",
          );
        }
        const downstream = findTaskSummary(db, taskId);
        if (downstream === undefined) {
          throw new A2aError("NOT_FOUND", `下游任务 ${taskId} 不存在`);
        }
        if (downstream.assignee !== agentId) {
          throw new A2aError("FORBIDDEN", "下游任务不属于当前 Agent");
        }
        const currentParent = findTaskParent(db, taskId);
        if (currentParent === null) {
          if (setTaskParentIfEmpty(db, taskId, message.taskId, at)) {
            appendTaskEvent(db, {
              id: newTaskEventId(),
              taskId,
              kind: "handoff",
              payload: {
                relation: "a2a",
                upstream_msg_id: msgId,
                upstream_task_id: message.taskId,
              },
              occurredAt: at,
            });
          }
        } else if (currentParent !== message.taskId) {
          throw new A2aError("CONFLICT", "下游任务已挂在另一条链路上,不能改写");
        }
      }
      markAck(db, msgId, at);
      markDeliveredByMsgId(db, msgId);
    })();
  }

  return { send, inbox, ack, wake };
}
