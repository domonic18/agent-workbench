import type { A2aThreadStatus } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  listMessagesByThreadIds,
  listThreadsForTask,
  type A2aThreadMessageRecord,
  type A2aThreadRecord,
} from "../../store/repositories/a2a.js";
import { findTaskById } from "../../store/repositories/task.js";
import { TaskError } from "../task/errors.js";

export interface A2aThreadView extends A2aThreadRecord {
  status: A2aThreadStatus;
  messages: A2aThreadMessageRecord[];
}

export interface A2aThreadReadService {
  /** 任务不存在抛 TaskError NOT_FOUND */
  byTask(taskId: string): A2aThreadView[];
}

export interface A2aThreadReadServiceDeps {
  db: Db;
  now?: () => number;
}

/**
 * 线程状态现算(02 §3.3),不落库:
 * 未 ACK 的 request / escalate → awaiting_reply;最后一封已 ACK 的 reply → completed;
 * 已过 deadline 仍无回复 → expired;其余 open。
 */
export function threadStatus(
  messages: readonly A2aThreadMessageRecord[],
  at: number,
): A2aThreadStatus {
  const awaiting = messages.some(
    (message) =>
      (message.intent === "request" || message.intent === "escalate") && message.ackAt === null,
  );
  if (awaiting) {
    return "awaiting_reply";
  }

  const last = messages.at(-1);
  if (last !== undefined && last.intent === "reply" && last.ackAt !== null) {
    return "completed";
  }

  const expired = messages.some(
    (message) =>
      (message.intent === "request" || message.intent === "escalate") &&
      message.deadlineAt !== null &&
      message.deadlineAt <= at &&
      !messages.some((other) => other.intent === "reply" && other.round > message.round),
  );
  return expired ? "expired" : "open";
}

export function createA2aThreadReadService(
  deps: A2aThreadReadServiceDeps,
): A2aThreadReadService {
  const db = deps.db;
  const now = deps.now ?? Date.now;

  return {
    byTask(taskId) {
      if (findTaskById(db, taskId) === undefined) {
        throw new TaskError("NOT_FOUND", `任务 ${taskId} 不存在`);
      }
      const threads = listThreadsForTask(db, taskId);
      const grouped = new Map<string, A2aThreadMessageRecord[]>();
      for (const message of listMessagesByThreadIds(db, threads.map((thread) => thread.id))) {
        const list = grouped.get(message.threadId);
        if (list === undefined) {
          grouped.set(message.threadId, [message]);
        } else {
          list.push(message);
        }
      }
      const at = now();
      return threads.map((thread) => {
        const messages = grouped.get(thread.id) ?? [];
        return { ...thread, status: threadStatus(messages, at), messages };
      });
    },
  };
}
