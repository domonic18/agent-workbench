import { describe, expect, it } from "vitest";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { createCommandHandler } from "./command-handler.js";
import type { InboundMessage } from "./inbound.js";

const silent = { info() {}, warn() {}, error() {} };

function event(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    eventId: "evt_1",
    eventType: "im.message.receive_v1",
    token: undefined,
    createTime: Date.now(),
    senderOpenId: "ou_1",
    senderType: "user",
    messageId: "om_1",
    chatId: "oc_1",
    chatType: "group",
    messageType: "text",
    content: JSON.stringify({ text: "/task list" }),
    ...overrides,
  };
}

function prepare(replyImpl: (event: InboundMessage, text: string) => Promise<void>) {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const replies: string[] = [];
  const handler = createCommandHandler(db, {
    reply: async (event, text) => {
      replies.push(text);
      await replyImpl(event, text);
    },
    log: silent,
  });
  return { db, handler, replies };
}

describe("createCommandHandler", () => {
  it("回执查询结果并写审计", async () => {
    const { db, handler, replies } = prepare(async () => {});

    await handler(event());

    expect(replies).toEqual(["当前没有任务。"]);
    expect(
      db.prepare("SELECT command, outcome, open_id, reply_text FROM feishu_command").get(),
    ).toEqual({
      command: "task.list",
      outcome: "handled",
      open_id: "ou_1",
      reply_text: "当前没有任务。",
    });
    db.close();
  });

  it("非文本与未登记指令都回不支持且留审计", async () => {
    const { db, handler, replies } = prepare(async () => {});

    await handler(event({ messageType: "image", content: JSON.stringify({ image_key: "img" }) }));
    await handler(event({ eventId: "evt_2", content: JSON.stringify({ text: "你好" }) }));

    expect(replies[0]).toContain("不支持");
    expect(replies[1]).toContain("不支持该指令");
    expect(
      db.prepare("SELECT command, outcome FROM feishu_command ORDER BY id").all(),
    ).toEqual([
      { command: null, outcome: "unsupported" },
      { command: null, outcome: "unsupported" },
    ]);
    db.close();
  });

  it("回执失败不抛错,审计仍落库", async () => {
    const { db, handler } = prepare(async () => {
      throw new Error("网络抖动");
    });

    await expect(handler(event())).resolves.toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM feishu_command").get()).toEqual({ n: 1 });
    db.close();
  });
});
