import { TOOL_GATE } from "../../shared/constants.js";
import type { RunContext, ToolCall } from "./gate.js";

export interface ApprovalRequest {
  ctx: RunContext;
  call: ToolCall;
  reason: string;
}

/** 审批通道由执行面注入;返回 false 即拒绝,抛错按拒绝处理 */
export type ApprovalRequester = (
  request: ApprovalRequest,
  signal: AbortSignal,
) => Promise<boolean>;

export type ApprovalOutcome = "approved" | "rejected" | "timeout" | "error";

/** 挂起有上限(05 §6.4):超时即拒,不无限等 */
export async function awaitApproval(
  request: ApprovalRequest,
  requester: ApprovalRequester | undefined,
  timeoutMs: number = TOOL_GATE.approvalTimeoutMs,
): Promise<ApprovalOutcome> {
  if (requester === undefined) {
    return "error";
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });
  try {
    const decided = requester(request, controller.signal).then((approved): ApprovalOutcome =>
      approved ? "approved" : "rejected",
    );
    return await Promise.race([decided, expired]);
  } catch {
    return "error";
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
