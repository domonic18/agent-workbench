import { describe, expect, it } from "vitest";
import { awaitApproval, type ApprovalRequest } from "./approval.js";
import type { RunContext } from "./gate.js";

const ctx: RunContext = {
  runId: "run_1",
  agentId: "agt_1",
  taskId: "T-1",
  workspaceRoot: "/workspace",
  usage: { kind: "unlimited" },
  grants: [],
};

const request: ApprovalRequest = {
  ctx,
  call: { tool: "fs.write", args: {} },
  reason: "L2 需审批",
};

describe("awaitApproval", () => {
  it("批准返回 approved", async () => {
    await expect(awaitApproval(request, async () => true)).resolves.toBe("approved");
  });

  it("拒绝返回 rejected", async () => {
    await expect(awaitApproval(request, async () => false)).resolves.toBe("rejected");
  });

  it("超时即拒并中止等待", async () => {
    let aborted = false;
    const outcome = await awaitApproval(
      request,
      (_req, signal) =>
        new Promise<boolean>(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      10,
    );
    expect(outcome).toBe("timeout");
    expect(aborted).toBe(true);
  });

  it("审批通道异常按 error 处理,不当作批准", async () => {
    await expect(
      awaitApproval(request, async () => {
        throw new Error("通道断开");
      }),
    ).resolves.toBe("error");
  });

  it("未接入审批通道时返回 error", async () => {
    await expect(awaitApproval(request, undefined)).resolves.toBe("error");
  });
});
