import { describe, expect, it } from "vitest";
import { EVENT_KINDS, mapLine } from "./mapper.js";

const AT = "2026-10-29T06:20:06.481Z";
const AT_MS = Date.parse(AT);

function assistant(message: Record<string, unknown>): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: AT,
    sessionId: "11111111-2222-3333-4444-555555555555",
    message,
  });
}

describe("Claude JSONL 事件映射", () => {
  it("assistant 的文本、工具调用与 token 用量分别成事件", () => {
    const events = mapLine(
      assistant({
        model: "claude-sonnet-4-6",
        content: [
          { type: "text", text: "处理中" },
          { type: "tool_use", id: "call_1", name: "Bash", input: { command: "ls" } },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
        },
      }),
      1,
    );

    expect(events.map((event) => event.kind)).toEqual([
      EVENT_KINDS.assistantMessage,
      EVENT_KINDS.toolCall,
      "token_usage",
    ]);
    expect(events[0]).toMatchObject({
      occurredAt: AT_MS,
      payload: { text: "处理中", model: "claude-sonnet-4-6" },
    });
    expect(events[1]?.payload).toMatchObject({ tool_use_id: "call_1", name: "Bash" });
    expect(events[2]?.payload).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_creation_tokens: 40,
      source: "assistant_message",
    });
  });

  it("<synthetic> 不入 token_usage,正文照常上报", () => {
    const events = mapLine(
      assistant({
        model: "<synthetic>",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      1,
    );
    expect(events.map((event) => event.kind)).toEqual([EVENT_KINDS.assistantMessage]);
  });

  it("user 的 tool_result 只留预览与长度", () => {
    const events = mapLine(
      JSON.stringify({
        type: "user",
        timestamp: AT,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              is_error: true,
              content: "x".repeat(400),
            },
          ],
        },
      }),
      1,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe(EVENT_KINDS.toolResult);
    expect(events[0]?.payload).toMatchObject({
      tool_use_id: "call_1",
      is_error: true,
      length: 400,
    });
    expect(String(events[0]?.payload.preview).length).toBeLessThan(400);
  });

  it("忽略 isMeta、附件与无法解析的行", () => {
    expect(mapLine("not json", 1)).toEqual([]);
    expect(
      mapLine(
        JSON.stringify({ type: "user", isMeta: true, timestamp: AT, message: { content: "hi" } }),
        1,
      ),
    ).toEqual([]);
    expect(mapLine(JSON.stringify({ type: "attachment", timestamp: AT }), 1)).toEqual([]);
  });

  it("时间戳缺失时用兜底时间", () => {
    const events = mapLine(
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      5_000,
    );
    expect(events[0]?.occurredAt).toBe(5_000);
  });
});
