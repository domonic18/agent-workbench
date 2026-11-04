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

describe("协作群播报渲染(无 @,控制台直发)", () => {
  it("① 交接播报:发起方 → 收件方,uuid 取消息 id", () => {
    expect(buildHandoffBulletin(HANDOFF, "oc_group")).toEqual({
      chatId: "oc_group",
      text: "〔交接〕Agent A → Agent B:需要一份接口契约 · 任务 tsk_up",
      uuid: "msg_1",
      taskId: "tsk_up",
    });
  });

  it("② 接单播报:承接方 + 任务标题,uuid 区别于交接", () => {
    expect(buildAcceptBulletin(ACCEPT, "oc_group")).toEqual({
      chatId: "oc_group",
      text: "〔接单〕Agent B 已接单「整理接口契约」 · 任务 tsk_down",
      uuid: "a2a:ack:msg_1",
      taskId: "tsk_down",
    });
  });

  it("③ 完成播报:完成方 + 结论已同步给发起方,uuid 按任务固定", () => {
    expect(buildCompletionBulletin(COMPLETION, "oc_group")).toEqual({
      chatId: "oc_group",
      text: "〔完成〕Agent B 已完成「整理接口契约」,结论已同步给 Agent A · 任务 tsk_down",
      uuid: "task_done:tsk_down",
      taskId: "tsk_down",
    });
  });

  it("④ 验收播报:根任务闭环,uuid 按任务固定", () => {
    expect(buildClosureBulletin(CLOSURE, "oc_group")).toEqual({
      chatId: "oc_group",
      text: "〔验收〕任务「接口契约联调」已闭环 · 任务 tsk_up",
      uuid: "task_closed:tsk_up",
      taskId: "tsk_up",
    });
  });
});

describe("enqueueCollabBulletin", () => {
  it("按 collab:{uuid} 幂等入发件箱,同 uuid 只保留首条", async () => {
    const db = await openDatabase();
    const bulletin = buildHandoffBulletin(HANDOFF, "oc_group");
    await enqueueCollabBulletin(db, bulletin, 1_000);
    await enqueueCollabBulletin(db, bulletin, 2_000);
    const row = await findOutboxByKey(db, "collab:msg_1");
    expect(row?.kind).toBe("collab_bulletin");
    expect(JSON.parse(row?.payloadJson ?? "{}")).toEqual({
      chatId: "oc_group",
      text: bulletin.text,
      uuid: "msg_1",
    });
    await db.close();
  });
});
