import { describe, expect, it } from "vitest";
import type { A2AIntent } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import {
  insertMessage,
  insertThread,
  markAck,
  type NewA2aMessage,
} from "../../store/repositories/a2a.js";
import { TaskError } from "../task/errors.js";
import { createA2aThreadReadService } from "./threads.js";

const AT = 10_000;

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
  for (const id of ["agt_a", "agt_b"]) {
    await db.run(
      `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
       VALUES (?, 'm1', ?, ?, 'hash', 'active', '[]', 0, 0)`,
      id, id, id,
    );
  }
  for (const [id, assignee] of [
    ["tsk_a", "agt_a"],
    ["tsk_b", "agt_b"],
  ] as const) {
    await db.run(
      `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
       VALUES (?, ?, 'console', ?, 'aw', 'exec', 'running', 'a2a', 0, 0)`,
      id, id, assignee,
    );
  }
  await insertThread(db, {
    id: "thr_1",
    initiatorTaskId: "tsk_a",
    initiatorAgent: "agt_a",
    responderAgent: "agt_b",
    createdAt: 1_000,
  });
  return db;
}

interface MessageSpec {
  round: number;
  intent?: A2AIntent;
  taskId?: string;
  deadlineAt?: number | null;
  ackAt?: number | null;
}

async function addMessage(db: Db, spec: MessageSpec): Promise<void> {
  const row: NewA2aMessage = {
    id: `msg_${spec.round}`,
    threadId: "thr_1",
    taskId: spec.taskId ?? "tsk_a",
    round: spec.round,
    replyToMsgId: null,
    fromAgent: spec.taskId === "tsk_b" ? "agt_b" : "agt_a",
    toAgent: spec.taskId === "tsk_b" ? "agt_a" : "agt_b",
    intent: spec.intent ?? "request",
    summary: "需要契约",
    expect: "OpenAPI",
    deadlineAt: spec.deadlineAt ?? null,
    refsJson: "[]",
    authTicket: null,
    createdAt: 1_000 + spec.round,
  };
  await insertMessage(db, row);
  if (spec.ackAt !== undefined && spec.ackAt !== null) {
    await markAck(db, row.id, spec.ackAt);
  }
}

async function statusOf(specs: MessageSpec[], at = AT): Promise<string> {
  const db = await prepare();
  for (const spec of specs) {
    await addMessage(db, spec);
  }
  const service = createA2aThreadReadService({ db, now: () => at });
  const threads = await service.byTask("tsk_a");
  const result = threads[0]?.status ?? "";
  await db.close();
  return result;
}

describe("A2A 线程读取", () => {
  it("按任务返回线程,消息按 round 升序", async () => {
    const db = await prepare();
    await addMessage(db, { round: 1, ackAt: 1_500 });
    await addMessage(db, { round: 2, intent: "reply", taskId: "tsk_b", ackAt: 2_000 });
    const service = createA2aThreadReadService({ db, now: () => AT });

    const threads = await service.byTask("tsk_a");
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ id: "thr_1", status: "completed" });
    expect(threads[0]?.messages.map((row) => row.round)).toEqual([1, 2]);
    await db.close();
  });

  it("接收方任务也能读到同一线程", async () => {
    const db = await prepare();
    await addMessage(db, { round: 1, ackAt: 1_500 });
    await addMessage(db, { round: 2, intent: "reply", taskId: "tsk_b", ackAt: 2_000 });
    const service = createA2aThreadReadService({ db, now: () => AT });
    expect((await service.byTask("tsk_b")).map((row) => row.id)).toEqual(["thr_1"]);
    await db.close();
  });

  it("ACK 交接出的下游任务能读到上游线程", async () => {
    const db = await prepare();
    await addMessage(db, { round: 1, ackAt: 1_500 });
    await db.run("UPDATE task SET parent_task_id = 'tsk_a' WHERE id = 'tsk_b'");
    await db.run(
      `INSERT INTO task_event (id, task_id, seq, kind, payload_json, occurred_at)
       VALUES ('tev_1', 'tsk_b', 1, 'handoff',
         '{"relation":"a2a","upstream_msg_id":"msg_1","upstream_task_id":"tsk_a"}', 1_500)`,
    );
    const service = createA2aThreadReadService({ db, now: () => AT });

    expect((await service.byTask("tsk_b")).map((row) => row.id)).toEqual(["thr_1"]);
    await db.close();
  });

  it("任务不存在抛 NOT_FOUND", async () => {
    const db = await prepare();
    const service = createA2aThreadReadService({ db, now: () => AT });
    await expect(service.byTask("tsk_missing")).rejects.toThrow(TaskError);
    try {
      await service.byTask("tsk_missing");
    } catch (error) {
      expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    }
    await db.close();
  });
});

describe("线程状态现算", () => {
  it("未 ACK 的 request 为 awaiting_reply", async () => {
    expect(await statusOf([{ round: 1, ackAt: null }])).toBe("awaiting_reply");
  });

  it("最后一封已 ACK 的 reply 为 completed", async () => {
    expect(
      await statusOf([
        { round: 1, ackAt: 1_500 },
        { round: 2, intent: "reply", taskId: "tsk_b", ackAt: 2_000 },
      ]),
    ).toBe("completed");
  });

  it("reply 未 ACK 时不判 completed", async () => {
    expect(
      await statusOf([
        { round: 1, ackAt: 1_500 },
        { round: 2, intent: "reply", taskId: "tsk_b", ackAt: null },
      ]),
    ).toBe("open");
  });

  it("已过 deadline 且无回复为 expired", async () => {
    expect(await statusOf([{ round: 1, ackAt: 1_500, deadlineAt: AT }])).toBe("expired");
  });

  it("deadline 未到为 open", async () => {
    expect(await statusOf([{ round: 1, ackAt: 1_500, deadlineAt: AT + 1 }])).toBe("open");
  });

  it("未 ACK 且已过 deadline 优先判 awaiting_reply", async () => {
    expect(await statusOf([{ round: 1, ackAt: null, deadlineAt: 1_000 }])).toBe("awaiting_reply");
  });

  it("空线程为 open", async () => {
    const db = await prepare();
    const service = createA2aThreadReadService({ db, now: () => AT });
    const threads = await service.byTask("tsk_a");
    expect(threads[0]?.status).toBe("open");
    await db.close();
  });
});
