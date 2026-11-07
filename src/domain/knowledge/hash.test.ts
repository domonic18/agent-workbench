import { describe, expect, it } from "vitest";
import { hashKnowledgeContent } from "./hash.js";

describe("hashKnowledgeContent", () => {
  it("内容相同给出相同哈希", () => {
    expect(hashKnowledgeContent("部署手册")).toBe(hashKnowledgeContent("部署手册"));
    expect(hashKnowledgeContent("部署手册")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("换行差异不算内容变更", () => {
    expect(hashKnowledgeContent("第一行\r\n第二行")).toBe(
      hashKnowledgeContent("第一行\n第二行"),
    );
    expect(hashKnowledgeContent("第一行\r第二行")).toBe(hashKnowledgeContent("第一行\n第二行"));
  });

  it("内容不同哈希不同", () => {
    expect(hashKnowledgeContent("部署")).not.toBe(hashKnowledgeContent("部署 "));
  });
});
