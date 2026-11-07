import { describe, expect, it } from "vitest";
import { timelinePayloadView } from "./timeline-payload.js";

describe("对话流事件正文抽取", () => {
  it("用户消息取正文并给出字数", () => {
    const view = timelinePayloadView("user_message", { text: "补一条均线", length: 5 });
    expect(view.body).toBe("补一条均线");
    expect(view.meta).toBe("5 字");
  });

  it("助手回复带上模型名", () => {
    const view = timelinePayloadView("assistant_message", {
      text: "好的",
      model: "claude-sonnet-4-6",
    });
    expect(view.body).toBe("好的");
    expect(view.meta).toBe("claude-sonnet-4-6");
  });

  it("思考只保留长度,正文不入库", () => {
    const view = timelinePayloadView("thinking", { length: 120, model: "m" });
    expect(view.body).toContain("不入库");
    expect(view.meta).toBe("120 字 · m");
  });

  it("工具调用按代码块展示入参并标出工具名", () => {
    const view = timelinePayloadView("tool_call", {
      name: "Read",
      input: '{"path":"a.ts"}',
      input_length: 13,
    });
    expect(view.code).toBe(true);
    expect(view.body).toBe('{"path":"a.ts"}');
    expect(view.meta).toBe("Read");
  });

  it("工具结果标出错误态", () => {
    const view = timelinePayloadView("tool_result", {
      preview: "file not found",
      length: 14,
      is_error: true,
    });
    expect(view.error).toBe(true);
    expect(view.body).toBe("file not found");
  });

  it("Token 用量汇总输入输出与缓存", () => {
    const view = timelinePayloadView("token_usage", {
      model: "claude-sonnet-4-6",
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 5,
      cache_creation_tokens: 0,
    });
    expect(view.body).toBe("输入 100 · 输出 20 · 缓存读 5");
    expect(view.meta).toBe("claude-sonnet-4-6");
  });

  it("未知类型不丢内容也不报错", () => {
    expect(timelinePayloadView("mystery", { anything: 1 }).body).toBe("（无正文）");
  });
});
