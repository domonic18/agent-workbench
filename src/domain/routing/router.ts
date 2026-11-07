import type { RouteRule, WorkPolicy } from "./policy.js";

/**
 * 单一确定性 Router(arch/01 §9.2)。本模块只覆盖五步链中的第 3~5 步:
 * ① 准入(Source 身份与 schema)在入口适配层完成;
 * ② 去重((source, source_event_id) 幂等)由 ingest 事务内的首到先得插入完成;
 * ③ Thread owner 直通 / ④ RouteRule 派新工 / ⑤ 未知即交人 在这里,纯函数无 DB。
 * 路由不调用模型,没有评估租约或迟到结果;处置原因封闭可枚举。
 */

export interface ThreadRef {
  readonly source: string;
  readonly externalKind: string;
  readonly externalKey: string;
}

export function threadKeyOf(ref: ThreadRef): string {
  return `${ref.source}|${ref.externalKind}|${ref.externalKey}`;
}

/** 路由视角的触发事实:已归一化,含解析好的 Thread 键列表 */
export interface RoutingTriggerView {
  readonly source: string;
  readonly kind: string;
  readonly project: string | null;
  readonly threadKeys: readonly string[];
}

/** 已解析的有效 owner 订阅(含其事项状态;状态由调用方在同一事务内读出) */
export interface OwnerView {
  readonly threadKey: string;
  readonly workItemId: string;
  readonly itemStatus: "open" | "done" | "cancelled";
}

export type RouteReason =
  | "no_project"
  | "no_route_rule"
  | "route_ambiguous"
  | "owner_ambiguous"
  | "owner_closed"
  | "owner_unassigned"
  | "target_unavailable"
  | "target_token_exhausted";

export type RouteOutcome =
  | { readonly decision: "owner_continue"; readonly workItemId: string; readonly threadKey: string }
  | { readonly decision: "assign"; readonly rule: RouteRule; readonly agentKey: string }
  | { readonly decision: "needs_person"; readonly reasonCode: RouteReason };

function ruleMatches(rule: RouteRule, trigger: RoutingTriggerView): boolean {
  if (rule.source !== trigger.source || rule.kind !== trigger.kind) {
    return false;
  }
  return rule.project === undefined || rule.project === trigger.project;
}

export function routeTrigger(
  policy: Pick<WorkPolicy, "rules" | "registry">,
  trigger: RoutingTriggerView,
  owners: readonly OwnerView[],
): RouteOutcome {
  // ③ Thread owner 直通:只认仍 open 的事项;done/cancelled 的订阅不产生续接
  const triggerKeys = new Set(trigger.threadKeys);
  const openOwners = owners.filter(
    (owner) => owner.itemStatus === "open" && triggerKeys.has(owner.threadKey),
  );
  const hadOwner = owners.some((owner) => triggerKeys.has(owner.threadKey));
  const distinctItems = new Set(openOwners.map((owner) => owner.workItemId));
  if (distinctItems.size > 1) {
    return { decision: "needs_person", reasonCode: "owner_ambiguous" };
  }
  if (openOwners.length > 0) {
    const owner = openOwners[0];
    if (owner !== undefined) {
      return { decision: "owner_continue", workItemId: owner.workItemId, threadKey: owner.threadKey };
    }
  }
  if (hadOwner) {
    return { decision: "needs_person", reasonCode: "owner_closed" };
  }

  // ④ RouteRule 派新工:未归属事件必须命中唯一规则
  const matches = policy.rules.filter((rule) => ruleMatches(rule, trigger));
  if (matches.length === 0) {
    return { decision: "needs_person", reasonCode: "no_route_rule" };
  }
  if (matches.length > 1) {
    return { decision: "needs_person", reasonCode: "route_ambiguous" };
  }
  const rule = matches[0];
  if (rule === undefined) {
    return { decision: "needs_person", reasonCode: "no_route_rule" };
  }
  if (trigger.project === null) {
    return { decision: "needs_person", reasonCode: "no_project" };
  }
  const roles = policy.registry[trigger.project];
  if (roles === undefined) {
    return { decision: "needs_person", reasonCode: "no_project" };
  }
  const agentKey = roles[rule.targetRole];
  if (agentKey === undefined) {
    return { decision: "needs_person", reasonCode: "no_project" };
  }

  // 角色解析出的 key 是否已注册且启用,由调用方在事务内核验(target_unavailable)
  return { decision: "assign", rule, agentKey };
}
