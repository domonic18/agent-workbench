import { describe, expect, it } from "vitest";
import { isScopeName, OVERVIEW_SCOPE, taskScopeName, workItemScopeName } from "./scopes.js";

describe("投影作用域命名", () => {
  it("已知形态:overview / task:<id> / work_item:<id>", () => {
    expect(isScopeName(OVERVIEW_SCOPE)).toBe(true);
    expect(isScopeName(taskScopeName("tsk_1"))).toBe(true);
    expect(isScopeName(workItemScopeName("wim_1"))).toBe(true);
  });

  it("拒绝残缺或带杂串的形态", () => {
    expect(isScopeName("task:")).toBe(false);
    expect(isScopeName("work_item:")).toBe(false);
    expect(isScopeName("workitem:wim_1")).toBe(false);
    expect(isScopeName("work_item:wim 1")).toBe(false);
    expect(isScopeName("")).toBe(false);
  });
});
