import { describe, expect, it } from "vitest";
import { sanitizeJsonValue, toJsonbText } from "./json.js";

const NUL = "\u0000";
const HIGH_SURROGATE = "\ud800";
const LOW_SURROGATE = "\udc00";
const EMOJI = "\ud83d\ude00";
const REPLACEMENT = "\uFFFD";

describe("jsonb 可存化清洗", () => {
  it("NUL 换成替换符", () => {
    expect(sanitizeJsonValue(`a${NUL}b`)).toBe(`a${REPLACEMENT}b`);
  });

  it("孤立代理项换成替换符,完整代理对保留", () => {
    expect(sanitizeJsonValue(`${HIGH_SURROGATE}x`)).toBe(`${REPLACEMENT}x`);
    expect(sanitizeJsonValue(`x${LOW_SURROGATE}`)).toBe(`x${REPLACEMENT}`);
    expect(sanitizeJsonValue(EMOJI)).toBe(EMOJI);
  });

  it("递归处理嵌套结构与对象键", () => {
    const value = { [`k${NUL}`]: [1, `a${NUL}b`, { c: HIGH_SURROGATE }] };
    expect(sanitizeJsonValue(value)).toEqual({
      [`k${REPLACEMENT}`]: [1, `a${REPLACEMENT}b`, { c: REPLACEMENT }],
    });
  });

  it("非字符串值原样保留", () => {
    expect(sanitizeJsonValue({ a: 1, b: true, c: null })).toEqual({ a: 1, b: true, c: null });
  });

  it("序列化结果可被 jsonb 解析", () => {
    const text = toJsonbText({ preview: `a${NUL}b${HIGH_SURROGATE}` });
    expect(text).not.toContain("\\u0000");
    expect(text).not.toContain("\\ud800");
    expect(JSON.parse(text)).toEqual({ preview: `a${REPLACEMENT}b${REPLACEMENT}` });
  });
});
