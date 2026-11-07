import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { findTaskById, listTaskEvents } from "../../store/repositories/task.js";
import { createTaskService, type TaskService } from "./service.js";

const NOW = 1_000;

async function prepare(): Promise<{ db: Db; service: TaskService }> {
  const db = await openDatabase();
  const service = createTaskService({ db, now: () => NOW });
  return { db, service };
}

async function insertTaskRow(
  db: Db,
  id: string,
  assignee: string,
  parentTaskId: string | null,
  status = "pending",
  stage = "intake",
): Promise<void> {
  await db.run(
    `INSERT INTO task (id, title, assigner, assignee, project, parent_task_id, stage, status, origin, created_at, updated_at)
     VALUES (?, '协作任务', 'console', ?, 'aw', ?, ?, ?, 'a2a', 0, 0)`,
    id, assignee, parentTaskId, stage, status,
  );
}

async function insertReply(db: Db, msgId: string, taskId: string, ackAt: number | null): Promise<void> {
  await db.run(
    `INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at)
     VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)`,
  );
  await db.run(
    `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, allowed_targets_json, status, created_at, updated_at)
     VALUES ('agt_a', 'm1', 'pa', 'A', 'hash', '[]', 'active', 0, 0),
            ('agt_b', 'm1', 'pb', 'B', 'hash', '[]', 'active', 0, 0)`,
  );
  await db.run(
    `INSERT INTO a2a_thread (id, initiator_task_id, initiator_agent, responder_agent, created_at)
     VALUES ('thr_1', ?, 'agt_a', 'agt_b', 0)`,
    taskId,
  );
  await db.run(
    `INSERT INTO a2a_message (id, thread_id, task_id, round, from_agent, to_agent, intent, summary, expect, ack_at, created_at)
     VALUES (?, 'thr_1', ?, 1, 'agt_b', 'agt_a', 'reply', '回执', '', ?, 0)`,
    msgId, taskId, ackAt,
  );
}

describe("closeAncestorsIfComplete(经 task service.update 触发)", () => {
  it("pending 根任务按 pending→running→done 两步收口,事件记 system actor", async () => {
    const { db, service } = await prepare();
    await insertTaskRow(db, "tsk_root", "agt_a", null);
    await insertTaskRow(db, "tsk_child", "agt_b", "tsk_root", "running");

    const { autoClosed } = await service.update({
      taskId: "tsk_child",
      assignee: "agt_b",
      status: "done",
    });

    expect(autoClosed.map((task) => task.id)).toEqual(["tsk_root"]);
    expect((await findTaskById(db, "tsk_root"))?.status).toBe("done");
    const rows = await listTaskEvents(db, "tsk_root", 0, 10);
    const kinds = rows.map((event) => event.kind);
    expect(kinds).toEqual(["resumed", "completed"]);
    const completed = rows.at(-1);
    expect(completed?.kind).toBe("completed");
    expect(completed?.payloadJson).toContain("auto_close");
    expect(completed?.payloadJson).toContain("system");
    await db.close();
  });

  it("存在未 ack 的回执时不收口(收口由回执确认路径触发)", async () => {
    const { db, service } = await prepare();
    await insertTaskRow(db, "tsk_root", "agt_a", null);
    await insertTaskRow(db, "tsk_child", "agt_b", "tsk_root", "running");
    await insertReply(db, "msg_1", "tsk_child", null);

    const first = await service.update({ taskId: "tsk_child", assignee: "agt_b", status: "done" });
    expect(first.autoClosed).toEqual([]);
    expect((await findTaskById(db, "tsk_root"))?.status).toBe("pending");
    await db.close();
  });

  it("cancelled 子任务同样计终态", async () => {
    const { db, service } = await prepare();
    await insertTaskRow(db, "tsk_root", "agt_a", null, "running");
    await insertTaskRow(db, "tsk_child", "agt_b", "tsk_root", "cancelled");

    const { autoClosed } = await service.update({
      taskId: "tsk_child",
      assignee: "agt_b",
      status: "cancelled",
    });
    expect(autoClosed.map((task) => task.id)).toEqual(["tsk_root"]);
    await db.close();
  });

  it("无子任务的任务不视为委派根,不收口", async () => {
    const { db, service } = await prepare();
    await insertTaskRow(db, "tsk_leaf", "agt_a", null, "running");

    const { autoClosed } = await service.update({
      taskId: "tsk_leaf",
      assignee: "agt_a",
      status: "done",
    });
    expect(autoClosed).toEqual([]);
    await db.close();
  });

  it("链式委派逐级收口:child done 收口 parent 与 grandparent", async () => {
    const { db, service } = await prepare();
    await insertTaskRow(db, "tsk_top", "agt_a", null, "running");
    await insertTaskRow(db, "tsk_mid", "agt_b", "tsk_top");
    await insertTaskRow(db, "tsk_low", "agt_c", "tsk_mid", "running");

    const { autoClosed } = await service.update({
      taskId: "tsk_low",
      assignee: "agt_c",
      status: "done",
    });
    expect(autoClosed.map((task) => task.id)).toEqual(["tsk_mid", "tsk_top"]);
    expect((await findTaskById(db, "tsk_top"))?.status).toBe("done");
    expect((await findTaskById(db, "tsk_mid"))?.status).toBe("done");
    await db.close();
  });
});
