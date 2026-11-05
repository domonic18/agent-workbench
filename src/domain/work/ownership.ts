import { WorkError } from "./errors.js";
import {
  findWorkItemById,
  type WorkItemRecord,
} from "../../store/repositories/work-item.js";
import { findWorkTriggerById } from "../../store/repositories/work-trigger.js";
import {
  findActiveOwnerSubscription,
  findWorkThreadByKey,
} from "../../store/repositories/work-thread.js";
import type { Db } from "../../store/database.js";

export type { WorkItemRecord };

/**
 * bug 裁决归属判定(M3.9-2):按 issue 线程定位进行中的事项,并核验调用者
 * 就是上报该 Bug 的机器人(origin 触发 actor.agent_id)。归属是裁决的
 * 前置闸门:不匹配即 FORBIDDEN,不猜「最近的事项」。
 */
export async function resolveBugOwnedItem(
  db: Db,
  agentId: string,
  issueRef: string,
): Promise<WorkItemRecord> {
  const thread = await findWorkThreadByKey(db, "bug", "issue", issueRef);
  if (thread === undefined) {
    throw new WorkError("NOT_FOUND", `issue ${issueRef} 没有对应工作线程`);
  }
  const subscription = await findActiveOwnerSubscription(db, thread.id);
  if (subscription === undefined) {
    throw new WorkError("NOT_FOUND", `issue ${issueRef} 没有进行中的事项`);
  }
  const item = await findWorkItemById(db, subscription.workItemId);
  if (item === undefined) {
    throw new WorkError("NOT_FOUND", "事项记录缺失");
  }
  if (item.originTriggerId === null) {
    throw new WorkError("FORBIDDEN", "事项无来源触发,无法核验归属");
  }
  const origin = await findWorkTriggerById(db, item.originTriggerId);
  if (origin === undefined) {
    throw new WorkError("NOT_FOUND", "来源触发记录缺失");
  }
  const originActor = JSON.parse(origin.actorJson) as { agent_id?: unknown };
  if (originActor.agent_id !== agentId) {
    throw new WorkError("FORBIDDEN", "只有上报该 Bug 的机器人可以接受或退回");
  }
  return item;
}
