import { describe, expect, it } from "vitest";
import {
  InvalidTransitionError,
  assertStageTransition,
  assertStatusTransition,
  canTransitionStatus,
  isRework,
  nextReworkCount,
} from "./state-machine.js";

describe("任务状态机", () => {
  it("正常流转放行", () => {
    expect(canTransitionStatus("pending", "running")).toBe(true);
    expect(canTransitionStatus("running", "review")).toBe(true);
    expect(canTransitionStatus("review", "done")).toBe(true);
    expect(canTransitionStatus("blocked", "running")).toBe(true);
  });

  it("跨级与逆行被拒", () => {
    expect(() => assertStatusTransition("pending", "done")).toThrow(InvalidTransitionError);
    expect(() => assertStatusTransition("blocked", "review")).toThrow(/非法状态跃迁/);
    expect(canTransitionStatus("running", "pending")).toBe(false);
  });

  it("终态没有出口", () => {
    expect(canTransitionStatus("done", "running")).toBe(false);
    expect(canTransitionStatus("cancelled", "pending")).toBe(false);
  });

  it("review 退回 running 记为返工", () => {
    expect(isRework("review", "running")).toBe(true);
    expect(isRework("running", "review")).toBe(false);
    expect(nextReworkCount(2, "review", "running")).toBe(3);
    expect(nextReworkCount(2, "review", "done")).toBe(2);
  });
});

describe("任务阶段机", () => {
  it("阶段只向前,返工可回 exec", () => {
    expect(() => assertStageTransition("intake", "plan")).not.toThrow();
    expect(() => assertStageTransition("review", "exec")).not.toThrow();
    expect(() => assertStageTransition("deliver", "plan")).toThrow(InvalidTransitionError);
  });

  it("closed 无出口", () => {
    expect(() => assertStageTransition("closed", "intake")).toThrow(/非法阶段跃迁/);
  });
});
