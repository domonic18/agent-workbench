import { describe, expect, it } from "vitest";
import {
  assertCapabilityTransition,
  canTransitionCapability,
  InvalidCapabilityTransitionError,
} from "./state-machine.js";

describe("capability 状态机", () => {
  it("批准必须经 issuing 才能生效", () => {
    expect(canTransitionCapability("pending", "issuing")).toBe(true);
    expect(canTransitionCapability("issuing", "active")).toBe(true);
    expect(canTransitionCapability("pending", "active")).toBe(false);
  });

  it("issuing 的补偿出口是 rejected", () => {
    expect(canTransitionCapability("issuing", "rejected")).toBe(true);
    expect(canTransitionCapability("issuing", "pending")).toBe(false);
  });

  it("待批可被拒绝或超时收敛,active 只能过期或吊销", () => {
    expect(canTransitionCapability("pending", "rejected")).toBe(true);
    expect(canTransitionCapability("active", "expired")).toBe(true);
    expect(canTransitionCapability("active", "revoked")).toBe(true);
    expect(canTransitionCapability("active", "issuing")).toBe(false);
  });

  it("过期 / 吊销 / 拒绝都是终态", () => {
    for (const status of ["expired", "revoked", "rejected"] as const) {
      expect(canTransitionCapability(status, "pending")).toBe(false);
      expect(canTransitionCapability(status, "issuing")).toBe(false);
      expect(canTransitionCapability(status, "active")).toBe(false);
    }
  });

  it("非法跃迁抛错并带两端状态", () => {
    expect(() => assertCapabilityTransition("rejected", "active")).toThrow(
      InvalidCapabilityTransitionError,
    );
    expect(() => assertCapabilityTransition("rejected", "active")).toThrow(
      "非法授权状态跃迁: rejected → active",
    );
    expect(() => assertCapabilityTransition("pending", "issuing")).not.toThrow();
  });
});
