import { describe, expect, it } from "vitest";
import { openDatabase } from "../database.js";
import { runMigrations } from "../migrator.js";
import { recordFeishuCommand } from "./feishu-command.js";

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

describe("recordFeishuCommand", () => {
  it("落库解析结果与回执,原文超长截断", () => {
    const db = prepare();
    recordFeishuCommand(db, {
      eventId: "evt_1",
      openId: "ou_1",
      chatId: "oc_1",
      rawText: "x".repeat(5000),
      command: null,
      outcome: "unsupported",
      replyText: "不支持该指令。",
      createdAt: 1_700_000_000_000,
    });

    const row = db
      .prepare("SELECT event_id, command, outcome, length(raw_text) AS len FROM feishu_command")
      .get();
    expect(row).toEqual({ event_id: "evt_1", command: null, outcome: "unsupported", len: 4000 });
    db.close();
  });
});
