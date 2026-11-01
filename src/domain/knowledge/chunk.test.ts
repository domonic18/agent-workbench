import { describe, expect, it } from "vitest";
import { KNOWLEDGE_INDEX } from "../../shared/constants.js";
import { splitMarkdown } from "./chunk.js";

describe("splitMarkdown", () => {
  it("空内容不产生分块", () => {
    expect(splitMarkdown("")).toEqual([]);
    expect(splitMarkdown("  \r\n\r\n ")).toEqual([]);
  });

  it("统一换行并保留段间空行", () => {
    expect(splitMarkdown("第一段\r\n内容\r\n\r\n第二段")).toEqual(["第一段\n内容\n\n第二段"]);
  });

  it("短段合并到上限内", () => {
    const content = ["a".repeat(200), "b".repeat(200), "c".repeat(200)].join("\n\n");
    expect(splitMarkdown(content)).toEqual([content]);
  });

  it("超过上限的段落按码点切分,不劈开代理对", () => {
    const content = "😀".repeat(KNOWLEDGE_INDEX.chunkMaxChars + 50);
    const chunks = splitMarkdown(content);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => Array.from(chunk).length)).toEqual([
      KNOWLEDGE_INDEX.chunkMaxChars,
      50,
    ]);
    expect(chunks.join("")).toBe(content);
  });

  it("长段切分后仍按上限合并", () => {
    const content = Array.from({ length: 3 }, () =>
      "字".repeat(KNOWLEDGE_INDEX.chunkMaxChars),
    ).join("\n\n");
    const chunks = splitMarkdown(content);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(KNOWLEDGE_INDEX.chunkMaxChars);
    }
  });
});
