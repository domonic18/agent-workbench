import { describe, expect, it } from "vitest";
import type {
  AcceptNotice,
  ClosureNotice,
  CompletionNotice,
  HandoffNotice,
} from "./notice.js";
import { openDatabase } from "../../store/database.js";
import { findOutboxByKey } from "../../store/repositories/outbox.js";
import {
  buildAcceptBulletin,
  buildClosureBulletin,
  buildCompletionBulletin,
  buildHandoffBulletin,
  enqueueCollabBulletin,
} from "./bulletin.js";

const HANDOFF: HandoffNotice = {
  msgId: "msg_1",
  taskId: "tsk_up",
  threadId: "thr_1",
  summary: "需要一份接口契约",
  from: { id: "agt_a", displayName: "Agent A" },
  to: { id: "agt_b", displayName: "Agent B" },
};

const ACCEPT: AcceptNotice = {
  msgId: "msg_1",
  taskId: "tsk_down",
  title: "整理接口契约",
  from: { id: "agt_a", displayName: "Agent A" },
  to: { id: "agt_b", displayName: "Agent B" },
};

const COMPLETION: CompletionNotice = {
  taskId: "tsk_down",
  title: "整理接口契约",
  from: { id: "agt_b", displayName: "Agent B" },
  to: { id: "agt_a", displayName: "Agent A" },
};

const CLOSURE: ClosureNotice = { taskId: "tsk_up", title: "接口契约联调" };

function cardText(card: Record<string, unknown>): {
  title: string;
  template: string;
  elements: string[];
} {
  const header = card.header as { title: { content: string }; template: string };
  const body = card.body as { elements: { tag: string; content?: string }[] };
  return {
    title: header.title.content,
    template: header.template,
    elements: body.elements.filter((e) => e.tag === "markdown").map((e) => e.content ?? ""),
  };
}

describe("协作群播报卡片(无 @,控制台直发)", () => {
  it("① 交接卡片:发起方 → 收件方,uuid 取消息 id", () => {
    const bulletin = buildHandoffBulletin(HANDOFF, "oc_group");
    expect(bulletin.uuid).toBe("msg_1");
    expect(bulletin.taskId).toBe("tsk_up");
    const view = cardText(bulletin.card);
    expect(cardText(bulletin.card).title).toBe("〔交接〕Agent A → Agent B");
    expect(view.template).toBe("blue");
    expect(view.elements[0]).toBe("**事项**:需要一份接口契约");
    expect(view.elements[1]).toContain("任务 `tsk_up`");
    expect(bulletin.card.schema).toBe("2.0");
  });

  it("② 接单卡片:承接方 + 任务标题,uuid 区别于交接", () => {
    const bulletin = buildAcceptBulletin(ACCEPT, "oc_group");
    expect(bulletin.uuid).toBe("a2a:ack:msg_1");
    const view = cardText(bulletin.card);
    expect(view.title).toBe("〔接单〕Agent B 已接单");
    expect(view.template).toBe("turquoise");
    expect(view.elements[0]).toBe("**任务**:整理接口契约");
  });

  it("③ 完成卡片:完成方 + 结论已同步给发起方,uuid 按任务固定", () => {
    const bulletin = buildCompletionBulletin(COMPLETION, "oc_group");
    expect(bulletin.uuid).toBe("task_done:tsk_down");
    const view = cardText(bulletin.card);
    expect(view.title).toBe("〔完成〕Agent B 已完成");
    expect(view.template).toBe("green");
    expect(view.elements[0]).toBe(
      "**任务**:整理接口契约\n**结论**:已同步给 Agent A",
    );
  });

  it("④ 验收卡片:根任务闭环,uuid 按任务固定", () => {
    const bulletin = buildClosureBulletin(CLOSURE, "oc_group");
    expect(bulletin.uuid).toBe("task_closed:tsk_up");
    const view = cardText(bulletin.card);
    expect(view.title).toBe("〔验收〕任务已闭环");
    expect(view.template).toBe("indigo");
    expect(view.elements[0]).toBe("**任务**:接口契约联调");
  });

  it("动态内容打断 markdown 语法,防任务标题注入链接或富文本", () => {
    const hostile = buildAcceptBulletin(
      { ...ACCEPT, title: "修复 [钓鱼链接](https://evil.example) **加粗**`代码`\n换行注入" },
      "oc_group",
    );
    const body = cardText(hostile.card).elements[0]!;
    expect(body).not.toContain("[钓鱼链接](https://evil.example)");
    expect(body).not.toContain("**加粗**");
    expect(body).not.toContain("\n换行注入");
    expect(body).toContain("钓鱼链接");
    expect(body).toContain("evil.example");
  });
});

describe("enqueueCollabBulletin", () => {
  it("按 collab:{uuid} 幂等入发件箱,载荷为卡片不是文本", async () => {
    const db = await openDatabase();
    const bulletin = buildHandoffBulletin(HANDOFF, "oc_group");
    await enqueueCollabBulletin(db, bulletin, 1_000);
    await enqueueCollabBulletin(db, bulletin, 2_000);
    const row = await findOutboxByKey(db, "collab:msg_1");
    expect(row?.kind).toBe("collab_bulletin");
    const payload = JSON.parse(row?.payloadJson ?? "{}") as {
      chatId: string;
      card: Record<string, unknown>;
      text?: string;
      uuid: string;
    };
    expect(payload.chatId).toBe("oc_group");
    expect(payload.card.schema).toBe("2.0");
    expect(payload.text).toBeUndefined();
    expect(payload.uuid).toBe("msg_1");
    await db.close();
  });
});
