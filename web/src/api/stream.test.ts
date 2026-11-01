import { afterEach, describe, expect, it } from "vitest";
import { getClientId, queryKeyForScope, reconnectDelay } from "./stream.js";

describe("实时订阅辅助", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("重连退避 1s 起翻倍,封顶 30s", () => {
    expect(reconnectDelay(1)).toBe(1_000);
    expect(reconnectDelay(2)).toBe(2_000);
    expect(reconnectDelay(3)).toBe(4_000);
    expect(reconnectDelay(6)).toBe(30_000);
    expect(reconnectDelay(20)).toBe(30_000);
  });

  it("client_id 稳定且符合服务端校验", () => {
    const first = getClientId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(getClientId()).toBe(first);
  });

  it("非法 client_id 会被替换", () => {
    localStorage.setItem("aw_client_id", "../bad");
    const id = getClientId();
    expect(id).not.toBe("../bad");
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });

  it("scope 映射到查询键", () => {
    expect(queryKeyForScope("overview")).toEqual(["overview"]);
    expect(queryKeyForScope("task:tsk_1")).toEqual(["task", "tsk_1"]);
    expect(queryKeyForScope("unknown")).toEqual([]);
  });
});
