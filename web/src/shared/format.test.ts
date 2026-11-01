import { describe, expect, it } from "vitest";
import {
  formatCompactDuration,
  formatDateTime,
  formatDuration,
  formatExactTokens,
  formatRelativeTime,
  formatTokens,
} from "./format.js";

describe("token 格式化", () => {
  it("千分位", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1_234)).toBe("1,234");
    expect(formatTokens(999_999)).toBe("999,999");
    expect(formatExactTokens(1_234_567)).toBe("1,234,567");
  });

  it("百万以上缩写且去掉多余小数", () => {
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(1_000_000)).toBe("1M");
  });
});

describe("时间格式化", () => {
  it("绝对时间按本地时区补零", () => {
    const at = new Date(2026, 10, 1, 8, 5, 3).getTime();
    expect(formatDateTime(at)).toBe("2026-11-01 08:05:03");
  });

  it("耗时按秒/分/时/天分档,负值归零", () => {
    expect(formatDuration(-5_000)).toBe("0 秒");
    expect(formatDuration(9_400)).toBe("9 秒");
    expect(formatDuration(90_000)).toBe("1 分钟");
    expect(formatDuration(3_600_000)).toBe("1 小时");
    expect(formatDuration(5_400_000)).toBe("1 小时 30 分");
    expect(formatDuration(86_400_000)).toBe("1 天");
    expect(formatDuration(90_000_000)).toBe("1 天 1 小时");
  });

  it("紧凑耗时用于窄列", () => {
    expect(formatCompactDuration(9_400)).toBe("9s");
    expect(formatCompactDuration(90_000)).toBe("1m");
    expect(formatCompactDuration(3_600_000)).toBe("1h");
    expect(formatCompactDuration(4_320_000)).toBe("1h12m");
    expect(formatCompactDuration(86_400_000)).toBe("1d");
    expect(formatCompactDuration(97_200_000)).toBe("1d3h");
  });

  it("相对时间分档", () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(now - 3_000, now)).toBe("刚刚");
    expect(formatRelativeTime(now - 30_000, now)).toBe("30 秒前");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 小时前");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2 天前");
  });
});
