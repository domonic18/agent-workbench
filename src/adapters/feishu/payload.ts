import type { InboundMessage } from "./inbound.js";

interface ReceivePayload {
  event_id?: string;
  token?: string;
  create_time?: string;
  event_type?: string;
  sender?: {
    sender_type?: string;
    sender_id?: { open_id?: string };
  };
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
    create_time?: string;
  };
}

function parseTimestamp(...values: (string | undefined)[]): number | undefined {
  for (const value of values) {
    if (value === undefined || value.trim() === "") {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * 把长连接事件拍平成入站消息。群消息正文含 @_user_N 占位符,
 * 由 M1.5-5 的解析器处理,这里不猜意图。
 */
export function toInboundMessage(data: ReceivePayload): InboundMessage | undefined {
  const message = data.message;
  if (message?.message_id === undefined || message.chat_id === undefined) {
    return undefined;
  }
  const createTime = parseTimestamp(data.create_time, message.create_time);
  if (createTime === undefined) {
    return undefined;
  }
  return {
    // event_id 在 SDK 类型里可空,退化为消息 ID 兜底才能保持去重
    eventId: data.event_id ?? `msg:${message.message_id}`,
    eventType: data.event_type ?? "im.message.receive_v1",
    token: data.token,
    createTime,
    senderOpenId: data.sender?.sender_id?.open_id,
    senderType: data.sender?.sender_type ?? "",
    messageId: message.message_id,
    chatId: message.chat_id,
    chatType: message.chat_type ?? "",
    messageType: message.message_type ?? "",
    content: message.content ?? "",
  };
}
