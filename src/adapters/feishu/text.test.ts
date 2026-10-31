import { describe, expect, it } from "vitest";
import { extractText } from "./text.js";

describe("extractText", () => {
  it("解码 text 消息并剥离 @ 占位符", () => {
    expect(extractText(JSON.stringify({ text: "@_user_1 /task list" }))).toBe("/task list");
    expect(extractText(JSON.stringify({ text: "@_user_1 /task T-1" }))).toBe("/task T-1");
  });

  it("保留原因里的多词文本,压缩空白", () => {
    expect(extractText(JSON.stringify({ text: "/reject  T-1   磁盘   已满\n" }))).toBe(
      "/reject T-1 磁盘 已满",
    );
  });

  it("非 text 形态或坏 JSON 返回 undefined", () => {
    expect(extractText(JSON.stringify({ image_key: "img_v1" }))).toBeUndefined();
    expect(extractText("{not json")).toBeUndefined();
    expect(extractText("null")).toBeUndefined();
  });
});
