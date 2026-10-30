import { describe, expect, it } from "vitest";
import { healthPayload } from "./health.js";

describe("healthPayload", () => {
  it("按整秒返回运行时长", () => {
    expect(healthPayload("0.1.0", 0, "ok", 65_500)).toEqual({
      status: "ok",
      version: "0.1.0",
      db: "ok",
      uptime: 65,
    });
  });

  it("时钟回拨时不返回负值", () => {
    expect(healthPayload("0.1.0", 1_000, "ok", 500).uptime).toBe(0);
  });

  it("库不可写时整体降级", () => {
    expect(healthPayload("0.1.0", 0, "unavailable", 0)).toMatchObject({
      status: "degraded",
      db: "unavailable",
    });
  });
});
