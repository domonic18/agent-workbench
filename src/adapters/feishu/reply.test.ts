import { describe, expect, it, vi } from "vitest";
import type { InboundMessage } from "./inbound.js";
import { chooseReplyMode, createReplyer, REPLY_WINDOW_MS } from "./reply.js";

const NOW = 1_700_000_000_000;

function makeEvent(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    eventId: "evt_1",
    eventType: "im.message.receive_v1",
    token: undefined,
    createTime: NOW,
    senderOpenId: "ou_1",
    senderType: "user",
    messageId: "om_1",
    chatId: "oc_1",
    chatType: "group",
    messageType: "text",
    content: '{"text":"/task list"}',
    ...overrides,
  };
}

describe("chooseReplyMode", () => {
  it("24 小时内引用原消息,超过 24 小时改发新消息", () => {
    expect(chooseReplyMode(NOW - REPLY_WINDOW_MS, NOW)).toBe("reply");
    expect(chooseReplyMode(NOW, NOW)).toBe("reply");
    expect(chooseReplyMode(NOW - REPLY_WINDOW_MS - 1, NOW)).toBe("new");
  });
});

describe("createReplyer", () => {
  it("窗口内回复原消息,窗口外按 chat_id 新建", async () => {
    const sender = { reply: vi.fn(async () => {}), send: vi.fn(async () => {}) };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const reply = createReplyer(sender, log, () => NOW);

    await reply(makeEvent(), "窗口内");
    expect(sender.reply).toHaveBeenCalledWith("om_1", "窗口内");
    expect(sender.send).not.toHaveBeenCalled();

    await reply(makeEvent({ createTime: NOW - REPLY_WINDOW_MS - 1, chatId: "oc_2" }), "窗口外");
    expect(sender.send).toHaveBeenCalledWith("oc_2", "窗口外");
    expect(sender.reply).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenLastCalledWith(
      expect.objectContaining({ chatId: "oc_2", replyMode: "new" }),
      "飞书回执已发送",
    );
  });

  it("发送失败向上抛出,由调用方决定如何记录", async () => {
    const sender = {
      reply: vi.fn(async () => {
        throw new Error("230020 频控");
      }),
      send: vi.fn(async () => {}),
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const reply = createReplyer(sender, log, () => NOW);

    await expect(reply(makeEvent(), "x")).rejects.toThrow("230020");
    expect(log.info).not.toHaveBeenCalled();
  });
});
