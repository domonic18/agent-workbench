import type { Db } from "../../store/database.js";
import { findAgentByKey } from "../../store/repositories/identity.js";
import { TASK_LIMITS } from "../../shared/constants.js";
import { appendWorkItemEvent, insertWorkItem } from "../../store/repositories/work-item.js";
import { insertWorkerInboxIfNew } from "../../store/repositories/work-inbox.js";
import {
  findActiveOwnerSubscription,
  insertSubscriptionIfNew,
  revokeSubscription,
} from "../../store/repositories/work-thread.js";
import type { UsageState } from "../capability/gate.js";
import type { RouteOutcome } from "../routing/router.js";
import type { WorkPolicy } from "../routing/policy.js";
import { dispatchBugDecision, deliverInputToAssignee } from "./decision.js";
import { dispatchGithubEvidence } from "./evidence.js";
import type { DispatchContext, ResolvedDisposition, WorkRequest } from "./contract.js";

export type OwnerContinueOutcome = Extract<RouteOutcome, { decision: "owner_continue" }>;
export type AssignOutcome = Extract<RouteOutcome, { decision: "assign" }>;

export interface DispatchDeps {
  policy: WorkPolicy;
  /** 控制台协作群;工作事项状态卡片的目标群,未配置时不入队 */
  collabChatId?: string;
  /** M4-1 实时解析 Agent 用量状态;缺省无限量 */
  resolveUsage?: (db: Db, agentId: string) => Promise<UsageState>;
  newItemId: () => string;
  newEventId: () => string;
  newInboxId: () => string;
  newThreadId: () => string;
  newSubscriptionId: () => string;
}

export interface DispatchOutcome {
  readonly resolved: ResolvedDisposition;
  readonly newInboxIds: readonly string[];
}

function titleOf(req: WorkRequest, workKind: string): string {
  const candidate = req.payload["title"];
  if (typeof candidate === "string" && candidate.trim() !== "") {
    return candidate.trim().slice(0, TASK_LIMITS.title);
  }
  return `${workKind} · ${req.source}/${req.kind} · ${req.sourceEventId}`.slice(
    0,
    TASK_LIMITS.title,
  );
}

function tokenExhausted(outcome: AssignOutcome, policyVersion: string): DispatchOutcome {
  return {
    resolved: {
      disposition: "needs_person",
      reasonCode: "target_token_exhausted",
      ruleId: outcome.rule.ruleId,
      ruleVersion: policyVersion,
      workItemId: null,
      targetAgentId: null,
    },
    newInboxIds: [],
  };
}

/**
 * Thread owner 直通(arch/01 §9.2 ③):Input 投给事项的当前承接者。
 * 无活跃承接者(assignment 尚未领取或已退回)时确定性交人,不猜目标。
 * github 来源走证据分支;bug.accepted/returned 走人工裁决分支。
 */
export async function dispatchOwnerContinue(
  db: Db,
  ctx: DispatchContext,
  deps: Pick<
    DispatchDeps,
    "policy" | "collabChatId" | "newEventId" | "newInboxId" | "newThreadId" | "newSubscriptionId"
  >,
  outcome: OwnerContinueOutcome,
): Promise<DispatchOutcome> {
  if (ctx.request.source === "github") {
    return dispatchGithubEvidence(db, ctx, deps, outcome);
  }
  if (
    ctx.request.source === "bug" &&
    (ctx.request.kind === "accepted" || ctx.request.kind === "returned")
  ) {
    return dispatchBugDecision(db, ctx, deps, outcome);
  }
  return deliverInputToAssignee(db, ctx, deps, outcome.workItemId);
}

/**
 * RouteRule 派新工(arch/01 §9.2 ④):Mandate 按当前 policy 快照落事项,
 * 建 owner 订阅并投 assignment;目标未注册/停用时确定性交人。
 */
export async function dispatchAssign(
  db: Db,
  ctx: DispatchContext,
  deps: DispatchDeps,
  outcome: AssignOutcome,
): Promise<DispatchOutcome> {
  const agent = await findAgentByKey(db, outcome.agentKey);
  if (agent === undefined || agent.status !== "active") {
    return {
      resolved: {
        disposition: "needs_person",
        reasonCode: "target_unavailable",
        ruleId: outcome.rule.ruleId,
        ruleVersion: deps.policy.version,
        workItemId: null,
        targetAgentId: null,
      },
      newInboxIds: [],
    };
  }

  if (deps.resolveUsage !== undefined) {
    const usage = await deps.resolveUsage(db, agent.id);
    if (usage.kind === "unavailable" || (usage.kind === "metered" && usage.hardStop && usage.usedTokens >= usage.dailyLimit)) {
      return tokenExhausted(outcome, deps.policy.version);
    }
  }

  const definition = deps.policy.workKinds[outcome.rule.workKind];
  if (definition === undefined) {
    throw new Error(`work_kind ${outcome.rule.workKind} 未定义(policy 与规则漂移)`);
  }
  const itemId = deps.newItemId();
  await insertWorkItem(db, {
    id: itemId,
    project: ctx.project,
    kind: outcome.rule.workKind,
    title: titleOf(ctx.request, outcome.rule.workKind),
    expectedResult: definition.mandate.expectedResult,
    scopeJson: JSON.stringify({ scope: definition.mandate.scope, evidence: definition.evidence }),
    originTriggerId: ctx.triggerId,
    authorizationKind: "none",
    authorizationRef: ctx.authorizationRef,
    policyVersion: deps.policy.version,
    createdAt: ctx.at,
  });
  await appendWorkItemEvent(db, {
    id: deps.newEventId(),
    workItemId: itemId,
    kind: "routed",
    triggerId: ctx.triggerId,
    evidenceRefsJson: ctx.refsJson,
    payloadJson: JSON.stringify({
      rule_id: outcome.rule.ruleId,
      rule_version: deps.policy.version,
      target_role: outcome.rule.targetRole,
      target_agent_id: agent.id,
    }),
    occurredAt: ctx.at,
  });

  for (const bound of ctx.boundThreads) {
    const insertedSub = await insertSubscriptionIfNew(db, {
      id: deps.newSubscriptionId(),
      workThreadId: bound.threadId,
      workItemId: itemId,
      mode: "owner",
      createdBy: "router",
      policyVersion: deps.policy.version,
      createdAt: ctx.at,
    });
    if (!insertedSub) {
      // 已有有效 owner(事项已 closed 的历史订阅):一个事务内撤销旧 owner 再建新
      const previous = await findActiveOwnerSubscription(db, bound.threadId);
      if (previous !== undefined) {
        await revokeSubscription(db, previous.id, ctx.at);
        await insertSubscriptionIfNew(db, {
          id: deps.newSubscriptionId(),
          workThreadId: bound.threadId,
          workItemId: itemId,
          mode: "owner",
          createdBy: "router",
          policyVersion: deps.policy.version,
          createdAt: ctx.at,
        });
      }
    }
  }

  const inboxId = deps.newInboxId();
  const created = await insertWorkerInboxIfNew(db, {
    id: inboxId,
    kind: "assignment",
    workItemId: itemId,
    triggerId: ctx.triggerId,
    targetAgentId: agent.id,
    idempotencyKey: `assign:${ctx.triggerId}`,
    payloadJson: JSON.stringify({
      expectedResult: definition.mandate.expectedResult,
      scope: definition.mandate.scope,
      evidence: definition.evidence,
    }),
    createdAt: ctx.at,
  });
  const newInboxIds: string[] = [];
  if (created) {
    newInboxIds.push(inboxId);
  }
  await appendWorkItemEvent(db, {
    id: deps.newEventId(),
    workItemId: itemId,
    kind: "assigned",
    triggerId: ctx.triggerId,
    evidenceRefsJson: "[]",
    payloadJson: JSON.stringify({ target_agent_id: agent.id, inbox_id: inboxId }),
    occurredAt: ctx.at,
  });
  return {
    resolved: {
      disposition: "routed",
      reasonCode: null,
      ruleId: outcome.rule.ruleId,
      ruleVersion: deps.policy.version,
      workItemId: itemId,
      targetAgentId: agent.id,
    },
    newInboxIds,
  };
}
