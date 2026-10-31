import type { CommandOutcome } from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface FeishuCommandRecord {
  eventId: string;
  openId: string;
  chatId: string;
  rawText: string;
  command: string | null;
  outcome: CommandOutcome;
  replyText: string;
  createdAt: number;
}

/** 审计原文截断,避免长消息撑大库;原文只在内网库内,不记日志 */
const MAX_RAW_TEXT = 4000;

export function recordFeishuCommand(db: Db, record: FeishuCommandRecord): void {
  db.prepare(
    `INSERT INTO feishu_command
       (event_id, open_id, chat_id, raw_text, command, outcome, reply_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.eventId,
    record.openId,
    record.chatId,
    record.rawText.slice(0, MAX_RAW_TEXT),
    record.command,
    record.outcome,
    record.replyText,
    record.createdAt,
  );
}
