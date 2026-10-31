import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig } from "../../config/env.js";
import type { CapabilityService } from "../../domain/capability/service.js";
import type { Db } from "../../store/database.js";
import { claimFeishuEvent } from "../../store/repositories/feishu-event.js";
import { handleCardCallback, type CardCallbackDeps } from "./callback.js";
import { buildCardCallbackResponse } from "./card.js";
import { createCommandHandler } from "./command-handler.js";
import { handleInboundMessage, type InboundLogger } from "./inbound.js";
import { toInboundMessage } from "./payload.js";
import { createReplyer } from "./reply.js";
import { ensureOk } from "./response.js";

export interface FeishuInbound {
  stop(): void;
}

/**
 * 长连接订阅(01 §8.1):消息事件与卡片回调同走这一条应用凭据认证的 WebSocket,
 * 无需公网回调地址与 Verification Token;事件仍按时间窗、白名单与 event_id 校验。
 * 启动失败由调用方决定是否致命。
 */
export async function startFeishuInbound(
  config: FeishuConfig,
  db: Db,
  service: Pick<CapabilityService, "approve" | "reject" | "find">,
  log: InboundLogger,
): Promise<FeishuInbound> {
  const allowed = new Set(config.allowedOpenIds);
  const client = new Lark.Client({ appId: config.appId, appSecret: config.appSecret });

  const reply = createReplyer(
    {
      reply: async (messageId, text) => {
        const response = await client.im.message.reply({
          path: { message_id: messageId },
          data: { msg_type: "text", content: JSON.stringify({ text }) },
        });
        ensureOk(response, "回执");
      },
      send: async (chatId, text) => {
        const response = await client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) },
        });
        ensureOk(response, "发送新消息");
      },
    },
    log,
  );

  const isAllowed = (openId: string): boolean => allowed.has(openId);
  const claimEvent = (eventId: string, eventType: string): boolean =>
    claimFeishuEvent(db, eventId, eventType);

  const deps = {
    expectedToken: config.verificationToken,
    isAllowed,
    claimEvent,
    reply,
    onCommand: createCommandHandler(db, { reply, log }),
    log,
  };

  const cardDeps: CardCallbackDeps = { isAllowed, claimEvent, service, log };

  // 长连接由 app 凭据认证,invoke 使用 needCheck:false,不需要 webhook 侧的 token/加密配置
  const dispatcher = new Lark.EventDispatcher({ loggerLevel: Lark.LoggerLevel.warn });

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
    // 返回值经 WSClient 回给飞书:toast 立即反馈,card 就地刷新为终态
    "card.action.trigger": async (data: unknown) => {
      try {
        const result = await handleCardCallback(cardDeps, data);
        log.info(
          { outcome: result.outcome, capabilityId: result.capabilityId },
          "飞书卡片回调",
        );
        return buildCardCallbackResponse(result);
      } catch (error) {
        log.error({ err: error }, "飞书卡片回调异常");
        return { toast: { type: "error", content: "处理失败,请稍后重试" } };
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
