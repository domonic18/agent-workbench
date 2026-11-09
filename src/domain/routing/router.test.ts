import { describe, expect, it } from "vitest";
import type { RouteRule, WorkPolicy } from "./policy.js";
import { routeTrigger, type OwnerView, type RoutingTriggerView } from "./router.js";

function policyFixture(overrides: Partial<Pick<WorkPolicy, "rules" | "registry">> = {}) {
  return {
    version: "test-version",
    workKinds: {
      bug_fix: { mandate: { expectedResult: "修好", scope: "只修缺陷" }, evidence: ["PR"] },
    },
    rules: [
      {
        ruleId: "r-bug",
        source: "bug",
        kind: "submitted",
        workKind: "bug_fix",
        targetRole: "primary",
      },
    ],
    registry: { "proj-1": { primary: "agt_a" } },
    ...overrides,
  };
}

function trigger(overrides: Partial<RoutingTriggerView> = {}): RoutingTriggerView {
  return { source: "bug", kind: "submitted", project: "proj-1", threadKeys: [], ...overrides };
}

function owner(overrides: Partial<OwnerView> = {}): OwnerView {
  return { threadKey: "bug|issue|1", workItemId: "wim_1", itemStatus: "open", ...overrides };
}

describe("routeTrigger 五步链", () => {
  it("唯一 open owner 直通", () => {
    const outcome = routeTrigger(policyFixture(), trigger({ threadKeys: ["bug|issue|1"] }), [
      owner(),
    ]);
    expect(outcome).toEqual({
      decision: "owner_continue",
      workItemId: "wim_1",
      threadKey: "bug|issue|1",
    });
  });

  it("多个 open owner 指向同一事项仍直通(按事项去重)", () => {
    const outcome = routeTrigger(
      policyFixture(),
      trigger({ threadKeys: ["bug|issue|1", "git|pr|9"] }),
      [owner(), owner({ threadKey: "git|pr|9" })],
    );
    expect(outcome).toEqual({
      decision: "owner_continue",
      workItemId: "wim_1",
      threadKey: "bug|issue|1",
    });
  });

  it("多个 open owner 指向不同事项交人:owner_ambiguous", () => {
    const outcome = routeTrigger(
      policyFixture(),
      trigger({ threadKeys: ["bug|issue|1", "bug|issue|2"] }),
      [owner(), owner({ threadKey: "bug|issue|2", workItemId: "wim_2" })],
    );
    expect(outcome).toEqual({ decision: "needs_person", reasonCode: "owner_ambiguous" });
  });

  it("多个 open owner 指向不同事项且来源 github:扇出逐事项", () => {
    const outcome = routeTrigger(
      policyFixture(),
      trigger({ source: "github", kind: "pr.closed", threadKeys: ["bug|issue|1", "bug|issue|2"] }),
      [owner(), owner({ threadKey: "bug|issue|2", workItemId: "wim_2" })],
    );
    expect(outcome).toEqual({
      decision: "owner_continue_multi",
      workItemIds: ["wim_1", "wim_2"],
      threadKey: "bug|issue|1",
    });
  });

  it("同一事项持有多个匹配线程时扇出去重", () => {
    const outcome = routeTrigger(
      policyFixture(),
      trigger({
        source: "github",
        kind: "pr.closed",
        threadKeys: ["github|pull_request|api-1", "bug|issue|2", "bug|issue|3"],
      }),
      [
        owner({ threadKey: "github|pull_request|api-1" }),
        owner({ threadKey: "bug|issue|2" }),
        owner({ threadKey: "bug|issue|3", workItemId: "wim_2" }),
      ],
    );
    expect(outcome).toEqual({
      decision: "owner_continue_multi",
      workItemIds: ["wim_1", "wim_2"],
      threadKey: "github|pull_request|api-1",
    });
  });

  it("owner 事项已结束不续接:owner_closed", () => {
    const outcome = routeTrigger(
      policyFixture(),
      trigger({ threadKeys: ["bug|issue|1"] }),
      [owner({ itemStatus: "done" })],
    );
    expect(outcome).toEqual({ decision: "needs_person", reasonCode: "owner_closed" });
  });

  it("owner 的线程不在本次触发的 threadRefs 中则忽略,照常走规则", () => {
    const outcome = routeTrigger(policyFixture(), trigger({ threadKeys: ["bug|issue|9"] }), [
      owner({ itemStatus: "open" }),
    ]);
    expect(outcome).toEqual({
      decision: "assign",
      rule: expect.objectContaining({ ruleId: "r-bug" }),
      agentKey: "agt_a",
    });
  });

  it("无规则命中:no_route_rule", () => {
    const outcome = routeTrigger(policyFixture(), trigger({ kind: "reopened" }), []);
    expect(outcome).toEqual({ decision: "needs_person", reasonCode: "no_route_rule" });
  });

  it("多条规则命中交人:route_ambiguous", () => {
    const ambiguous: readonly RouteRule[] = [
      { ruleId: "r-bug", source: "bug", kind: "submitted", workKind: "bug_fix", targetRole: "primary" },
      { ruleId: "r-bug-2", source: "bug", kind: "submitted", workKind: "bug_fix", targetRole: "backup" },
    ];
    const outcome = routeTrigger(policyFixture({ rules: ambiguous }), trigger(), []);
    expect(outcome).toEqual({ decision: "needs_person", reasonCode: "route_ambiguous" });
  });

  it("规则命中但触发无项目:no_project", () => {
    const outcome = routeTrigger(policyFixture(), trigger({ project: null }), []);
    expect(outcome).toEqual({ decision: "needs_person", reasonCode: "no_project" });
  });

  it("项目未登记注册表:no_project", () => {
    const outcome = routeTrigger(policyFixture(), trigger({ project: "proj-x" }), []);
    expect(outcome).toEqual({ decision: "needs_person", reasonCode: "no_project" });
  });

  it("项目角色缺映射:no_project", () => {
    const outcome = routeTrigger(
      policyFixture({ registry: { "proj-1": { backup: "agt_b" } } }),
      trigger(),
      [],
    );
    expect(outcome).toEqual({ decision: "needs_person", reasonCode: "no_project" });
  });

  it("项目限定规则只在该项目命中", () => {
    const scoped: readonly RouteRule[] = [
      {
        ruleId: "r-scoped",
        source: "bug",
        kind: "submitted",
        project: "proj-1",
        workKind: "bug_fix",
        targetRole: "primary",
      },
    ];
    const policy = policyFixture({ rules: scoped });
    expect(routeTrigger(policy, trigger({ project: "proj-2" }), [])).toEqual({
      decision: "needs_person",
      reasonCode: "no_route_rule",
    });
    expect(routeTrigger(policy, trigger(), [])).toEqual({
      decision: "assign",
      rule: expect.objectContaining({ ruleId: "r-scoped" }),
      agentKey: "agt_a",
    });
  });
});
