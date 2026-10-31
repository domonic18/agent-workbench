export interface InboundMessage {
  eventId: string;
  eventType: string;
  token: string | undefined;
  createTime: number;
  senderOpenId: string | undefined;
  senderType: string;
  messageId: string;
  chatId: string;
  chatType: string;
  messageType: string;
  content: string;
}

export type InboundOutcome = "handled" | "duplicate" | "denied" | "rejected";

export interface InboundLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface InboundDeps {
  expectedToken: string | undefined;
  isAllowed(openId: string): boolean;
  claimEvent(eventId: string, eventType: string): boolean;
  /** 回执按事件时间决定引用原消息还是发新消息(见 reply.ts) */
  reply(event: InboundMessage, text: string): Promise<void>;
  /** M1.5-5 的指令解析入口;本阶段只记录,不产生任务 */
  onCommand(event: InboundMessage): void | Promise<void>;
  log: InboundLogger;
}

const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const DENIED_RECEIPT = "无权限：仅白名单用户可向控制台下指令";

/**
 * 入站顺序:时间窗 → 来源 token → 白名单 → event_id 去重 → 交给指令解析(01 §8.1)。
 * 非白名单直接回执且不落库;白名单事件先认领 event_id,重复事件不再处理。
 */
export async function handleInboundMessage(
  deps: InboundDeps,
  event: InboundMessage,
  now: number = Date.now(),
): Promise<InboundOutcome> {
  if (
    !Number.isFinite(event.createTime) ||
    event.createTime - now > MAX_FUTURE_SKEW_MS ||
    now - event.createTime > MAX_EVENT_AGE_MS
  ) {
    deps.log.warn({ eventId: event.eventId }, "飞书事件时间戳超出窗口,丢弃");
    return "rejected";
  }

  if (deps.expectedToken !== undefined && event.token !== deps.expectedToken) {
    deps.log.warn({ eventId: event.eventId }, "飞书事件来源 token 不符,丢弃");
    return "rejected";
  }

  const openId = event.senderOpenId;
  if (openId === undefined || !deps.isAllowed(openId)) {
    try {
      await deps.reply(event, DENIED_RECEIPT);
    } catch (error) {
      deps.log.error({ err: error, eventId: event.eventId }, "无权限回执发送失败");
    }
    deps.log.warn({ eventId: event.eventId, chatId: event.chatId }, "非白名单用户下指令,已回执");
    return "denied";
  }

  if (!deps.claimEvent(event.eventId, event.eventType)) {
    deps.log.info({ eventId: event.eventId }, "重复飞书事件,跳过");
    return "duplicate";
  }

  await deps.onCommand(event);
  return "handled";
}
