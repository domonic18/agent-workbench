import type { InboundLogger, InboundMessage } from "./inbound.js";

/**
 * 回执窗口(01 §8.1):超过 24 小时不再引用原消息,改为在会话里发新消息。
 * 飞书 reply 接口本身没有 24h 限制,这是避免引用失效的产品策略;
 * 入站事件已限 24h,此分支只兜底处理延迟与边界。
 */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ReplyMode = "reply" | "new";

export function chooseReplyMode(createTime: number, now: number = Date.now()): ReplyMode {
  return now - createTime <= REPLY_WINDOW_MS ? "reply" : "new";
}

export interface FeishuSender {
  reply(messageId: string, text: string): Promise<void>;
  send(chatId: string, text: string): Promise<void>;
}

export type Replyer = (event: InboundMessage, text: string) => Promise<void>;

export function createReplyer(
  sender: FeishuSender,
  log: InboundLogger,
  now: () => number = Date.now,
): Replyer {
  return async (event, text) => {
    const mode = chooseReplyMode(event.createTime, now());
    if (mode === "reply") {
      await sender.reply(event.messageId, text);
    } else {
      await sender.send(event.chatId, text);
    }
    log.info(
      { eventId: event.eventId, chatId: event.chatId, replyMode: mode },
      "飞书回执已发送",
    );
  };
}
