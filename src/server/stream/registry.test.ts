import { describe, expect, it } from "vitest";
import { createStreamRegistry } from "./registry.js";

describe("SSE 连接登记", () => {
  it("超过 maxClients 拒绝新 client_id,同一 client_id 可续接", () => {
    const registry = createStreamRegistry(2);
    expect(registry.acquire("a")).toBe(true);
    expect(registry.acquire("a")).toBe(true);
    expect(registry.acquire("b")).toBe(true);
    expect(registry.acquire("c")).toBe(false);
    expect(registry.clientCount()).toBe(2);
  });

  it("释放全部连接后名额回收", () => {
    const registry = createStreamRegistry(1);
    expect(registry.acquire("a")).toBe(true);
    expect(registry.acquire("b")).toBe(false);
    registry.release("a");
    expect(registry.clientCount()).toBe(0);
    expect(registry.acquire("b")).toBe(true);
  });

  it("同一 client_id 释放一条仍占一个名额", () => {
    const registry = createStreamRegistry(1);
    registry.acquire("a");
    registry.acquire("a");
    registry.release("a");
    expect(registry.clientCount()).toBe(1);
    registry.release("a");
    expect(registry.clientCount()).toBe(0);
  });

  it("释放未知 client_id 不抛错", () => {
    const registry = createStreamRegistry(1);
    expect(() => registry.release("missing")).not.toThrow();
    expect(registry.clientCount()).toBe(0);
  });
});
