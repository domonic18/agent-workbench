import { describe, expect, it } from "vitest";
import { toInboundMessage } from "./payload.js";

const payload = {
  event_id: "evt_1",
  token: "token",
  create_time: "1700000000000",
  event_type: "im.message.receive_v1",
  sender: { sender_type: "user", sender_id: { open_id: "ou_1" } },
  message: {
    message_id: "om_1",
    chat_id: "oc_1",
    chat_type: "group",
    message_type: "text",
    content: '{"text":"hi"}',
    create_time: "1700000000000",
  },
};

describe("toInboundMessage", () => {
  it("把 SDK 事件拍平成入站消息", () => {
    expect(toInboundMessage(payload)).toEqual({
      eventId: "evt_1",
      eventType: "im.message.receive_v1",
      token: "token",
      createTime: 1_700_000_000_000,
      senderOpenId: "ou_1",
      senderType: "user",
      messageId: "om_1",
      chatId: "oc_1",
      chatType: "group",
      messageType: "text",
      content: '{"text":"hi"}',
    });
  });

  it("缺 event_id 时用消息 ID 兜底,保证可去重", () => {
    const { event_id: _eventId, ...withoutEventId } = payload;
    expect(toInboundMessage(withoutEventId)?.eventId).toBe("msg:om_1");
  });

  it("事件时间缺失时回退消息时间", () => {
    const { create_time: _createTime, ...withoutCreateTime } = payload;
    expect(toInboundMessage(withoutCreateTime)?.createTime).toBe(1_700_000_000_000);
  });

  it("缺消息 ID 或时间戳直接丢弃", () => {
    const { message_id: _messageId, ...messageWithoutId } = payload.message;
    expect(toInboundMessage({ ...payload, message: messageWithoutId })).toBeUndefined();

    const { create_time: _eventTime, ...eventWithoutTime } = payload;
    const { create_time: _messageTime, ...messageWithoutTime } = payload.message;
    expect(
      toInboundMessage({ ...eventWithoutTime, message: messageWithoutTime }),
    ).toBeUndefined();
  });
});
