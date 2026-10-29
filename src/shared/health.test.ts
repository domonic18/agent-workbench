import { describe, expect, it } from "vitest";
import { healthPayload } from "./health.js";

describe("healthPayload", () => {
  it("按整秒返回运行时长", () => {
    expect(healthPayload("0.1.0", 0, 65_500)).toEqual({
      status: "ok",
      version: "0.1.0",
      uptime: 65,
    });
  });

  it("时钟回拨时不返回负值", () => {
    expect(healthPayload("0.1.0", 1_000, 500).uptime).toBe(0);
  });
});
