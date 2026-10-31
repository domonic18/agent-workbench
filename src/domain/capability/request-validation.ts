import {
  CAPABILITY_ACTIONS,
  CAPABILITY_TTL,
  type CapabilityAction,
} from "../../shared/constants.js";
import { CapabilityError } from "./errors.js";

export interface CapabilityRequestInput {
  subject: string;
  target: string;
  action: string;
  scope: Record<string, unknown>;
  ttlSeconds: number;
  taskId: string;
  actor: string;
}

/** subject 是 Agent 身份串(如 `agent:codex`);登记表在 M2.5,这里只做字符集与长度约束 */
const SUBJECT = /^[A-Za-z0-9:._-]{1,128}$/;

export function validateRequest(input: CapabilityRequestInput): {
  ttlSeconds: number;
  scopeJson: string;
} {
  const detail: string[] = [];
  if (!SUBJECT.test(input.subject)) {
    detail.push("subject 只允许字母、数字与 : . _ - 且不超过 128 字符");
  }
  if (input.target.trim() === "" || input.target.length > 200) {
    detail.push("target 必须为 1~200 字符");
  }
  if (!CAPABILITY_ACTIONS.includes(input.action as CapabilityAction)) {
    detail.push(`action 只接受 ${CAPABILITY_ACTIONS.join(" / ")}`);
  }
  if (
    !Number.isInteger(input.ttlSeconds) ||
    input.ttlSeconds < 1 ||
    input.ttlSeconds > CAPABILITY_TTL.maxSeconds
  ) {
    detail.push(`ttlSeconds 必须为 1~${CAPABILITY_TTL.maxSeconds} 的整数`);
  }
  if (detail.length > 0) {
    throw new CapabilityError("VALIDATION_FAILED", "授权申请校验失败", detail);
  }
  return {
    ttlSeconds: input.ttlSeconds,
    scopeJson: JSON.stringify(input.scope ?? {}),
  };
}
