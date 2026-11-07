import { describe, expect, it } from "vitest";
import { openDatabase } from "../../store/database.js";
import { createCommandHandler } from "./command-handler.js";
import type { InboundMessage } from "./inbound.js";

const silent = { info() {}, warn() {}, error() {} };

function event(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    eventId: "evt_1",
    eventType: "im.message.receive_v1",
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

async function prepare(replyImpl: (event: InboundMessage, text: string) => Promise<void>) {
  const db = await openDatabase();
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
    const { db, handler, replies } = await prepare(async () => {});

    await handler(event());

    expect(replies).toEqual(["当前没有任务。"]);
    expect(
      await db.get("SELECT command, outcome, open_id, reply_text FROM feishu_command"),
    ).toEqual({
      command: "task.list",
      outcome: "handled",
      open_id: "ou_1",
      reply_text: "当前没有任务。",
    });
    await db.close();
  });

  it("聊天消息与非文本静默忽略:不回复不审计", async () => {
    const { db, handler, replies } = await prepare(async () => {});

    await handler(event({ messageType: "image", content: JSON.stringify({ image_key: "img" }) }));
    await handler(event({ eventId: "evt_2", content: JSON.stringify({ text: "你好" }) }));
    await handler(event({ eventId: "evt_3", content: JSON.stringify({ text: "发" }) }));

    expect(replies).toEqual([]);
    expect(await db.get("SELECT COUNT(*) AS n FROM feishu_command")).toEqual({ n: 0 });
    await db.close();
  });

  it("未登记的斜杠指令回不支持且留审计", async () => {
    const { db, handler, replies } = await prepare(async () => {});

    await handler(event({ content: JSON.stringify({ text: "/foo bar" }) }));

    expect(replies[0]).toContain("不支持该指令");
    expect(
      await db.all("SELECT command, outcome FROM feishu_command ORDER BY id"),
    ).toEqual([{ command: null, outcome: "unsupported" }]);
    await db.close();
  });

  it("回执失败不抛错,审计仍落库", async () => {
    const { db, handler } = await prepare(async () => {
      throw new Error("网络抖动");
    });

    await expect(handler(event())).resolves.toBeUndefined();
    expect(await db.get("SELECT COUNT(*) AS n FROM feishu_command")).toEqual({ n: 1 });
    await db.close();
  });
});
