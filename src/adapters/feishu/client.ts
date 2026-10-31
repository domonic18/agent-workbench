import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig } from "../../config/env.js";
import type { Db } from "../../store/database.js";
import { claimFeishuEvent } from "../../store/repositories/feishu-event.js";
import { handleInboundMessage, type InboundLogger, type InboundMessage } from "./inbound.js";
import { toInboundMessage } from "./payload.js";

export interface FeishuInbound {
  stop(): void;
}

/**
 * 长连接订阅(01 §8.1):不启用加密,连接由 app 凭据认证;
 * 事件仍按来源 token、时间戳与 event_id 校验。启动失败由调用方决定是否致命。
 */
export async function startFeishuInbound(
  config: FeishuConfig,
  db: Db,
  log: InboundLogger,
): Promise<FeishuInbound> {
  const allowed = new Set(config.allowedOpenIds);
  const client = new Lark.Client({ appId: config.appId, appSecret: config.appSecret });

  const deps = {
    expectedToken: config.verificationToken,
    isAllowed: (openId: string): boolean => allowed.has(openId),
    claimEvent: (eventId: string, eventType: string): boolean =>
      claimFeishuEvent(db, eventId, eventType),
    reply: async (messageId: string, text: string): Promise<void> => {
      const response = await client.im.message.reply({
        path: { message_id: messageId },
        data: { msg_type: "text", content: JSON.stringify({ text }) },
      });
      const code = response.code ?? 0;
      if (code !== 0) {
        throw new Error(`飞书回执失败: code=${code} msg=${response.msg ?? ""}`);
      }
    },
    onCommand: (event: InboundMessage): void => {
      log.info(
        { eventId: event.eventId, chatId: event.chatId, messageType: event.messageType },
        "白名单指令已接收,解析待 M1.5-5",
      );
    },
    log,
  };

  const dispatcher = new Lark.EventDispatcher({
    loggerLevel: Lark.LoggerLevel.warn,
    ...(config.verificationToken === undefined
      ? {}
      : { verificationToken: config.verificationToken }),
  });

  dispatcher.register({
    "im.message.receive_v1": async (data) => {
      const event = toInboundMessage(data);
      if (event === undefined) {
        log.warn({}, "飞书事件缺必要字段,丢弃");
        return;
      }
      try {
        await handleInboundMessage(deps, event);
      } catch (error) {
        log.error({ err: error, eventId: event.eventId }, "飞书入站处理失败");
      }
    },
  });

  const wsClient = new Lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    loggerLevel: Lark.LoggerLevel.warn,
    autoReconnect: true,
    source: "agent-workbench",
  });
  await wsClient.start({ eventDispatcher: dispatcher });

  return { stop: () => wsClient.close({ force: true }) };
}
