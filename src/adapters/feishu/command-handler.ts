import { executeCommand } from "../../domain/command/execute.js";
import type { Db } from "../../store/database.js";
import { recordFeishuCommand } from "../../store/repositories/feishu-command.js";
import { findTaskSummary, listTaskSummaries } from "../../store/repositories/task.js";
import type { InboundLogger, InboundMessage } from "./inbound.js";
import { extractText } from "./text.js";

export interface CommandHandlerDeps {
  reply(event: InboundMessage, text: string): Promise<void>;
  log: InboundLogger;
}

/**
 * 白名单事件的指令入口:解析 → 执行 → 审计 → 回执。
 * 审计先于回执,回执失败不丢审计;任何分支都不建单(01 §8.1)。
 * 控制台只响应显式斜杠命令:群里聊天消息不是命令,静默忽略,
 * 否则每次发言都被回「不支持该指令」刷屏。
 */
export function createCommandHandler(
  db: Db,
  deps: CommandHandlerDeps,
): (event: InboundMessage) => Promise<void> {
  return async (event) => {
    const text = event.messageType === "text" ? extractText(event.content) : undefined;
    if (text === undefined || !text.trimStart().startsWith("/")) {
      deps.log.info({ eventId: event.eventId, chatId: event.chatId }, "非指令消息,已忽略");
      return;
    }

    const result = await executeCommand(
      {
        listTasks: (limit) => listTaskSummaries(db, limit),
        findTask: (id) => findTaskSummary(db, id),
      },
      text,
    );

    try {
      await recordFeishuCommand(db, {
        eventId: event.eventId,
        openId: event.senderOpenId ?? "",
        chatId: event.chatId,
        rawText: text ?? event.content,
        command: result.command,
        outcome: result.outcome,
        replyText: result.reply,
        createdAt: Date.now(),
      });
    } catch (error) {
      deps.log.error({ err: error, eventId: event.eventId }, "指令审计写入失败");
    }

    try {
      await deps.reply(event, result.reply);
    } catch (error) {
      deps.log.error({ err: error, eventId: event.eventId }, "指令回执发送失败");
    }

    deps.log.info(
      { eventId: event.eventId, chatId: event.chatId, command: result.command, outcome: result.outcome },
      "飞书指令已处理",
    );
  };
}
