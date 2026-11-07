import { describe, expect, it } from "vitest";
import { KNOWLEDGE_STATUSES, type KnowledgeStatus } from "../../shared/constants.js";
import {
  assertKnowledgeStatusTransition,
  canTransitionKnowledgeStatus,
  InvalidKnowledgeTransitionError,
} from "./state-machine.js";

const LEGAL: Record<KnowledgeStatus, readonly KnowledgeStatus[]> = {
  draft: ["candidate", "active", "archived"],
  candidate: ["active", "archived"],
  active: ["archived"],
  archived: ["active"],
};

describe("知识条目状态机", () => {
  it("只放行登记过的跃迁", () => {
    for (const from of KNOWLEDGE_STATUSES) {
      for (const to of KNOWLEDGE_STATUSES) {
        expect(canTransitionKnowledgeStatus(from, to)).toBe(LEGAL[from].includes(to));
      }
    }
  });

  it("非法跃迁抛错并带上起止状态", () => {
    expect(() => assertKnowledgeStatusTransition("active", "candidate")).toThrow(
      InvalidKnowledgeTransitionError,
    );
    expect(() => assertKnowledgeStatusTransition("candidate", "draft")).toThrow(
      /非法知识状态跃迁: candidate → draft/,
    );
    expect(() => assertKnowledgeStatusTransition("draft", "draft")).toThrow();
  });

  it("采纳与恢复路径可用", () => {
    expect(() => assertKnowledgeStatusTransition("candidate", "active")).not.toThrow();
    expect(() => assertKnowledgeStatusTransition("archived", "active")).not.toThrow();
  });
});
