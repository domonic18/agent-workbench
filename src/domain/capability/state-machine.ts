import type { CapabilityStatus } from "../../shared/constants.js";

export class InvalidCapabilityTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`非法授权状态跃迁: ${from} → ${to}`);
    this.name = "InvalidCapabilityTransitionError";
  }
}

/**
 * 单向状态机(05 §2):
 * - 批准不能直接生效,必须经 issuing(Teleport 是外部 HTTP,签发结果不可能与改状态同事务);
 * - issuing 的唯一补偿出口是 rejected,由对账作业在 60s 后收敛,绝不长期停留;
 * - rejected 是终态,重新申请要新建记录,不复用被拒的那条。
 */
const TRANSITIONS: Record<CapabilityStatus, readonly CapabilityStatus[]> = {
  pending: ["issuing", "rejected"],
  issuing: ["active", "rejected"],
  active: ["expired", "revoked"],
  expired: [],
  revoked: [],
  rejected: [],
};

export function canTransitionCapability(from: CapabilityStatus, to: CapabilityStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertCapabilityTransition(from: CapabilityStatus, to: CapabilityStatus): void {
  if (!canTransitionCapability(from, to)) {
    throw new InvalidCapabilityTransitionError(from, to);
  }
}
