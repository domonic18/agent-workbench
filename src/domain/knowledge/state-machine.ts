import type { KnowledgeStatus } from "../../shared/constants.js";

export class InvalidKnowledgeTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`非法知识状态跃迁: ${from} → ${to}`);
    this.name = "InvalidKnowledgeTransitionError";
  }
}

/**
 * 知识条目状态机(02 §3.5 / 03 §4.4):
 * - candidate 是 Agent 写入的待采纳队列,只能经人采纳 → active 或丢弃 → archived;
 * - draft 是尚未公开的手工/导入条目,可直接转 active;
 * - archived 可恢复为 active,不设终态,删除另由 deleted_at 表达。
 */
const TRANSITIONS: Record<KnowledgeStatus, readonly KnowledgeStatus[]> = {
  draft: ["candidate", "active", "archived"],
  candidate: ["active", "archived"],
  active: ["archived"],
  archived: ["active"],
};

export function canTransitionKnowledgeStatus(
  from: KnowledgeStatus,
  to: KnowledgeStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertKnowledgeStatusTransition(from: KnowledgeStatus, to: KnowledgeStatus): void {
  if (!canTransitionKnowledgeStatus(from, to)) {
    throw new InvalidKnowledgeTransitionError(from, to);
  }
}
