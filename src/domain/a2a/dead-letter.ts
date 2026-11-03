import { enqueuePull } from "../../reliability/outbox.js";
import { A2A_DEAD_LETTER } from "../../shared/constants.js";
import { newPrefixedId } from "../../shared/ids.js";
import type { Db } from "../../store/database.js";
import {
  findMessageById,
  insertDeadLetter,
  insertMessage,
  listExpiredUnacked,
  maxRound,
} from "../../store/repositories/a2a.js";
import { markFailedByMsgId } from "../../store/repositories/outbox.js";
import { toInboxItem } from "./inbox.js";

export const DEAD_LETTER_REASON_EXPIRED = "deadline_expired";

const RECEIPT_SUMMARY = "消息已过期未确认,请重新发起";
const RECEIPT_EXPECT = "无需回复";

export interface DeadLetterSweepDeps {
  db: Db;
  now?: () => number;
  newMsgId?: () => string;
  newDeadLetterId?: () => string;
  /** 回执落库后唤醒发起方的长轮询 */
  wake?: (agentId: string) => void;
}

export interface DeadLetterSweepResult {
  deadLettered: number;
  /** 收到过期回执、需要唤醒的发起方 */
  senders: string[];
}

/**
 * 死信巡检(01 §9):deadline 已过仍未 ACK 的消息 → 出箱 failed + 死信 + 回执发起方。
 * 回执是同线程的 notify 消息,由「收件方」发回「发起方」,走信箱拉取送达。
 * 以出箱 CAS 做幂等:已 delivered 的 ACK 先到则本轮跳过,不自动重发。
 */
export function sweepDeadLetters(deps: DeadLetterSweepDeps): DeadLetterSweepResult {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const newMsgId = deps.newMsgId ?? (() => newPrefixedId("msg"));
  const newDeadLetterId = deps.newDeadLetterId ?? (() => newPrefixedId("dlq"));
  const at = now();
  const expired = listExpiredUnacked(db, at, A2A_DEAD_LETTER.batchSize);

  const senders = new Set<string>();
  let deadLettered = 0;

  for (const message of expired) {
    const handled = db.transaction((): boolean => {
      if (!markFailedByMsgId(db, message.id, DEAD_LETTER_REASON_EXPIRED)) {
        return false;
      }
      insertDeadLetter(db, {
        id: newDeadLetterId(),
        msgId: message.id,
        fromAgent: message.fromAgent,
        toAgent: message.toAgent,
        taskId: message.taskId,
        reason: DEAD_LETTER_REASON_EXPIRED,
        payloadJson: JSON.stringify(toInboxItem(message)),
        createdAt: at,
      });

      const receiptId = newMsgId();
      insertMessage(db, {
        id: receiptId,
        threadId: message.threadId,
        taskId: message.taskId,
        round: maxRound(db, message.threadId) + 1,
        replyToMsgId: message.id,
        fromAgent: message.toAgent,
        toAgent: message.fromAgent,
        intent: "notify",
        summary: RECEIPT_SUMMARY,
        expect: RECEIPT_EXPECT,
        deadlineAt: null,
        refsJson: "[]",
        authTicket: null,
        createdAt: at,
      });
      const receipt = findMessageById(db, receiptId);
      if (receipt === undefined) {
        throw new Error(`回执落库后读不到: ${receiptId}`);
      }
      enqueuePull(db, {
        idempotencyKey: `a2a_receipt:${message.id}`,
        kind: "a2a_message",
        taskId: message.taskId,
        msgId: receiptId,
        payloadJson: JSON.stringify(toInboxItem(receipt)),
        now: at,
      });
      return true;
    });
    if (handled) {
      deadLettered += 1;
      senders.add(message.fromAgent);
    }
  }

  for (const agentId of senders) {
    deps.wake?.(agentId);
  }
  return { deadLettered, senders: [...senders] };
}
