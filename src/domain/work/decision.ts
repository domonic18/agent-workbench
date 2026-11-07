import type { Db } from "../../store/database.js";
import {
  appendWorkItemEvent,
  findWorkItemById,
  updateWorkItemProjection,
} from "../../store/repositories/work-item.js";
import {
  findActiveAssignee,
  insertWorkerInboxIfNew,
} from "../../store/repositories/work-inbox.js";
import type { DispatchContext } from "./contract.js";
import type { DispatchDeps, DispatchOutcome, OwnerContinueOutcome } from "./dispatch.js";
import { notifyWorkEvent } from "./notify.js";

/**
 * bug 机器人裁决分支(M3.9-2,arch/01 §9.2 ③窄化):人工在原反馈群对 bot 下
 * 「接受/退回」,bot 经 work_decide 上报。接受即收口(done + acceptance_ref,
 * 停表 ended_at);退回不换事项——同一 WorkItem 回 execute,有活跃承接者才投
 * 返工 input 唤醒,否则确定性交人(owner_unassigned),不猜目标。
 */

function textOf(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** owner 直通共用的 Input 投递:发给事项当前承接者,无承接者时交人 */
export async function deliverInputToAssignee(
  db: Db,
  ctx: DispatchContext,
  deps: Pick<DispatchDeps, "newEventId" | "newInboxId">,
  workItemId: string,
): Promise<DispatchOutcome> {
  const assignee = await findActiveAssignee(db, workItemId);
  if (assignee === undefined) {
    return {
      resolved: {
        disposition: "needs_person",
        reasonCode: "owner_unassigned",
        ruleId: null,
        ruleVersion: null,
        workItemId,
        targetAgentId: null,
      },
      newInboxIds: [],
    };
  }
  const inboxId = deps.newInboxId();
  const created = await insertWorkerInboxIfNew(db, {
    id: inboxId,
    kind: "input",
    workItemId,
    triggerId: ctx.triggerId,
    targetAgentId: assignee,
    idempotencyKey: `input:${ctx.triggerId}`,
    payloadJson: ctx.threadRefsJson,
    createdAt: ctx.at,
  });
  const newInboxIds: string[] = [];
  if (created) {
    newInboxIds.push(inboxId);
    await appendWorkItemEvent(db, {
      id: deps.newEventId(),
      workItemId,
      kind: "input",
      triggerId: ctx.triggerId,
      evidenceRefsJson: ctx.refsJson,
      payloadJson: ctx.threadRefsJson,
      occurredAt: ctx.at,
    });
  }
  return {
    resolved: {
      disposition: "continued",
      reasonCode: null,
      ruleId: null,
      ruleVersion: null,
      workItemId,
      targetAgentId: assignee,
    },
    newInboxIds,
  };
}

export async function dispatchBugDecision(
  db: Db,
  ctx: DispatchContext,
  deps: Pick<DispatchDeps, "newEventId" | "newInboxId" | "collabChatId">,
  outcome: OwnerContinueOutcome,
): Promise<DispatchOutcome> {
  const item = await findWorkItemById(db, outcome.workItemId);
  const reason = textOf(ctx.request.payload, "reason");

  if (ctx.request.kind === "accepted") {
    if (item !== undefined) {
      await updateWorkItemProjection(db, {
        id: item.id,
        status: "done",
        attention: "none",
        acceptanceRef: ctx.triggerId,
        nextAction: null,
        endedAt: ctx.at,
        updatedAt: ctx.at,
      });
    }
    const eventId = deps.newEventId();
    await appendWorkItemEvent(db, {
      id: eventId,
      workItemId: outcome.workItemId,
      kind: "accepted",
      triggerId: ctx.triggerId,
      evidenceRefsJson: ctx.refsJson,
      payloadJson: JSON.stringify(ctx.request.payload),
      occurredAt: ctx.at,
    });
    await notifyWorkEvent(db, {
      workItemId: outcome.workItemId,
      eventId,
      kind: "accepted",
      chatId: deps.collabChatId,
      now: ctx.at,
    });
    return {
      resolved: {
        disposition: "continued",
        reasonCode: null,
        ruleId: null,
        ruleVersion: null,
        workItemId: outcome.workItemId,
        targetAgentId: null,
      },
      newInboxIds: [],
    };
  }

  if (item !== undefined) {
    await updateWorkItemProjection(db, {
      id: item.id,
      stage: "execute",
      attention: "blocked",
      nextAction: `退回返工:${reason ?? "未注明原因"}`,
      updatedAt: ctx.at,
    });
  }
  const eventId = deps.newEventId();
  await appendWorkItemEvent(db, {
    id: eventId,
    workItemId: outcome.workItemId,
    kind: "returned",
    triggerId: ctx.triggerId,
    evidenceRefsJson: ctx.refsJson,
    payloadJson: JSON.stringify(ctx.request.payload),
    occurredAt: ctx.at,
  });
  await notifyWorkEvent(db, {
    workItemId: outcome.workItemId,
    eventId,
    kind: "returned",
    chatId: deps.collabChatId,
    reason,
    now: ctx.at,
  });
  return deliverInputToAssignee(db, ctx, deps, outcome.workItemId);
}
