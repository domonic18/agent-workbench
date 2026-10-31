import { describe, expect, it } from "vitest";
import { classifyTool, decide, type RunContext } from "./gate.js";

function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run_1",
    agentId: "agt_1",
    taskId: "T-1",
    workspaceRoot: "/workspace",
    usage: { kind: "unlimited" },
    grants: [],
    ...overrides,
  };
}

describe("工具分级", () => {
  it("L0 / L1 只认登记过的点分名,其余一律 L2", () => {
    expect(classifyTool("fs.read")).toBe("L0");
    expect(classifyTool("a2a.inbox")).toBe("L0");
    expect(classifyTool("task.create")).toBe("L1");
    expect(classifyTool("kb.write")).toBe("L1");
    expect(classifyTool("fs.write")).toBe("L2");
    expect(classifyTool("bash.exec")).toBe("L2");
    expect(classifyTool("task_create")).toBe("L2");
  });
});

describe("decide", () => {
  it("L0 与 L1 直接放行", () => {
    expect(decide(context(), { tool: "fs.read", args: {} })).toEqual({
      verdict: "allow",
      level: "L0",
    });
    expect(decide(context(), { tool: "task.create", args: {} })).toEqual({
      verdict: "allow",
      level: "L1",
    });
  });

  it("清单外按 L2 转审批", () => {
    const decision = decide(context(), { tool: "fs.write", args: { path: "a" } });
    expect(decision.verdict).toBe("require_approval");
    expect(decision.level).toBe("L2");
  });

  it("命中已生效授权时放行 L2", () => {
    const decision = decide(context({ grants: ["fs.write"] }), { tool: "fs.write", args: {} });
    expect(decision).toEqual({ verdict: "allow", level: "L2", reason: "命中已生效授权" });
  });

  it("用量硬停先于等级:超限后连 L0 只读也拒", () => {
    const ctx = context({ usage: { kind: "metered", usedTokens: 100, dailyLimit: 100 } });
    expect(decide(ctx, { tool: "fs.read", args: {} })).toMatchObject({
      verdict: "deny",
      level: "L0",
    });
  });

  it("未到上限时放行,且不影响后续判定", () => {
    const ctx = context({ usage: { kind: "metered", usedTokens: 99, dailyLimit: 100 } });
    expect(decide(ctx, { tool: "fs.read", args: {} }).verdict).toBe("allow");
    expect(decide(ctx, { tool: "bash.exec", args: {} }).verdict).toBe("require_approval");
  });

  it("配置了上限但读不出用量时 fail-closed", () => {
    const ctx = context({ usage: { kind: "unavailable", reason: "账本不可达" } });
    const decision = decide(ctx, { tool: "fs.read", args: {} });
    expect(decision.verdict).toBe("deny");
    expect(decision.verdict === "deny" ? decision.reason : "").toContain("账本不可达");
  });

  it("拒绝理由可读,便于回给模型", () => {
    const decision = decide(context(), { tool: "fs.write", args: {} });
    expect(decision.verdict === "require_approval" ? decision.reason : "").toContain("L2");
  });
});
