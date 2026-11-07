import { afterEach, describe, expect, it } from "vitest";
import { getClientId, queryKeyForScope, queryKeysForScope, reconnectDelay } from "./stream.js";

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
    expect(queryKeyForScope("work_item:wim_1")).toEqual(["work-item", "wim_1"]);
    expect(queryKeyForScope("unknown")).toEqual([]);
  });

  it("overview 水位同时失效总览、任务列表与 Agent 名册", () => {
    expect(queryKeysForScope("overview")).toEqual([
      { queryKey: ["overview"], exact: false },
      { queryKey: ["tasks"], exact: false },
      // 名册精确匹配:前缀匹配会连带重取逐 Agent 的删除影响预览
      { queryKey: ["agents"], exact: true },
      { queryKey: ["work-items"], exact: false },
    ]);
    expect(queryKeysForScope("task:tsk_1")).toEqual([
      { queryKey: ["task", "tsk_1"], exact: false },
    ]);
    expect(queryKeysForScope("work_item:wim_1")).toEqual([
      { queryKey: ["work-item", "wim_1"], exact: false },
    ]);
    expect(queryKeysForScope("unknown")).toEqual([]);
  });

  it("详情键与列表键不串味", () => {
    // ["work-item","wim_1"] 是详情前缀,不该命中列表的 ["work-items",...]
    expect(queryKeyForScope("work_item:wim_1")[0]).not.toBe("work-items");
  });
});
