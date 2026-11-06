import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProjectSelection } from "./useProjectSelection.js";

const GROUPS = [
  {
    machineId: "mch_a",
    projects: [
      { name: "alpha", confirmed: false },
      { name: "beta", confirmed: false },
    ],
  },
  {
    machineId: "mch_b",
    projects: [{ name: "gamma", confirmed: false }],
  },
];

describe("useProjectSelection", () => {
  it("默认全选,并按机器分别计数", () => {
    const { result } = renderHook(() => useProjectSelection(GROUPS));
    expect(result.current.pickedCount).toBe(3);
    expect(result.current.pickedFor("mch_a").map((p) => p.name)).toEqual(["alpha", "beta"]);
    expect(result.current.pickedFor("mch_b").map((p) => p.name)).toEqual(["gamma"]);
  });

  it("取消勾选只影响本机同名项目", () => {
    const { result } = renderHook(() => useProjectSelection(GROUPS));
    act(() => {
      result.current.toggle("mch_a", "alpha", false);
    });
    expect(result.current.pickedFor("mch_a").map((p) => p.name)).toEqual(["beta"]);
    expect(result.current.pickedFor("mch_b").map((p) => p.name)).toEqual(["gamma"]);
    expect(result.current.pickedCount).toBe(2);
    expect(result.current.isChecked("mch_a", "alpha")).toBe(false);
    expect(result.current.isChecked("mch_b", "gamma")).toBe(true);
  });

  it("重新勾选后恢复", () => {
    const { result } = renderHook(() => useProjectSelection(GROUPS));
    act(() => {
      result.current.toggle("mch_a", "alpha", false);
    });
    act(() => {
      result.current.toggle("mch_a", "alpha", true);
    });
    expect(result.current.pickedCount).toBe(3);
  });
});
