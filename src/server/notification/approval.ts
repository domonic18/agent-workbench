import { buildApprovalCard } from "../../adapters/feishu/card.js";
import { enqueuePush } from "../../reliability/outbox.js";
import type { Db } from "../../store/database.js";
import type { CapabilityRecord } from "../../store/repositories/capability.js";

export interface ApprovalNotifierDeps {
  db: Db;
  /** 固定审批群;未配置则不推送,控制台照常可用(01 §8) */
  approvalChatId: string | undefined;
  now?: () => number;
}

/** 授权申请落库后入队一张飞书审批卡片;幂等键 cap:{id}:requested 保证重复入队不重复发卡 */
export function createApprovalNotifier(
  deps: ApprovalNotifierDeps,
): ((record: CapabilityRecord) => void) | undefined {
  const chatId = deps.approvalChatId;
  if (chatId === undefined) {
    return undefined;
  }
  return (record) => {
    const card = buildApprovalCard({
      capabilityId: record.id,
      subject: record.subject,
      target: record.target,
      action: record.action,
      ttlSeconds: record.ttlSeconds,
      taskId: record.taskId,
      scope: JSON.parse(record.scopeJson) as unknown,
    });
    enqueuePush(deps.db, {
      idempotencyKey: `cap:${record.id}:requested`,
      kind: "capability_approval",
      taskId: record.taskId,
      chatId,
      card,
      ...(deps.now === undefined ? {} : { now: deps.now() }),
    });
  };
}
