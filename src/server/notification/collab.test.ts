import { describe, expect, it } from "vitest";
import type { CompletionNotice, HandoffNotice } from "../../domain/collab/notice.js";
import { buildCompletionNotify, buildHandoffNotify } from "./collab.js";

const HANDOFF: HandoffNotice = {
  msgId: "msg_1",
  taskId: "tsk_up",
  threadId: "thr_1",
  summary: "需要一份接口契约",
  from: { id: "agt_a", displayName: "Agent A", botOpenId: "ou_a" },
  to: { id: "agt_b", displayName: "Agent B", botOpenId: "ou_b" },
};

const COMPLETION: CompletionNotice = {
  taskId: "tsk_down",
  title: "整理接口契约",
  from: { id: "agt_b", displayName: "Agent B", botOpenId: "ou_b" },
  to: { id: "agt_a", displayName: "Agent A", botOpenId: "ou_a" },
};

describe("协作通知渲染", () => {
  it("交接通知 @ 收件方,uuid 取消息 id", () => {
    expect(buildHandoffNotify(HANDOFF, "oc_group")).toEqual({
      chat_id: "oc_group",
      text: '<at user_id="ou_b">Agent B</at> 新任务交接:需要一份接口契约\n任务 tsk_up · 线程 thr_1',
      uuid: "msg_1",
    });
  });

  it("完成通知 @ 上游发起方,uuid 按任务固定", () => {
    expect(buildCompletionNotify(COMPLETION, "oc_group")).toEqual({
      chat_id: "oc_group",
      text: '<at user_id="ou_a">Agent A</at> 任务完成:整理接口契约(tsk_down)',
      uuid: "task_done:tsk_down",
    });
  });

  it("对方 bot 未注册 open_id 时退化为纯文本名字", () => {
    const notice: HandoffNotice = {
      ...HANDOFF,
      to: { id: "agt_b", displayName: "Agent B", botOpenId: null },
    };
    expect(buildHandoffNotify(notice, "oc_group").text).toBe(
      "Agent B 新任务交接:需要一份接口契约\n任务 tsk_up · 线程 thr_1",
    );
  });
});
