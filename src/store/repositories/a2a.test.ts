import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { runMigrations } from "../migrator.js";
import { insertOutbox, type NewOutbox } from "./outbox.js";
import {
  findMessageById,
  findThreadById,
  findThreadByInitiator,
  insertMessage,
  insertThread,
  listInbox,
  markAck,
  maxRound,
  type NewA2aMessage,
  type NewA2aThread,
} from "./a2a.js";

function prepare(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.prepare(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  ).run();
  for (const [id, project] of [
    ["agt_a", "pa"],
    ["agt_b", "pb"],
  ] as const) {
    db.prepare(
      `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
       VALUES (?, 'm1', ?, ?, 'hash', 'active', '[]', 0, 0)`,
    ).run(id, project, id);
  }
  for (const [id, assignee] of [
    ["tsk_a", "agt_a"],
    ["tsk_b", "agt_b"],
  ] as const) {
    db.prepare(
      `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
       VALUES (?, ?, 'console', ?, 'aw', 'exec', 'running', 'a2a', 0, 0)`,
    ).run(id, id, assignee);
  }
  return db;
}

function thread(overrides: Partial<NewA2aThread> = {}): NewA2aThread {
  return {
    id: "thr_1",
    initiatorTaskId: "tsk_a",
    initiatorAgent: "agt_a",
    responderAgent: "agt_b",
    createdAt: 1_000,
    ...overrides,
  };
}

function message(overrides: Partial<NewA2aMessage> = {}): NewA2aMessage {
  return {
    id: "msg_1",
    threadId: "thr_1",
    taskId: "tsk_a",
    round: 1,
    replyToMsgId: null,
    fromAgent: "agt_a",
    toAgent: "agt_b",
    intent: "request",
    summary: "需要一份接口契约",
    expect: "OpenAPI 片段",
    deadlineAt: 9_999,
    refsJson: "[]",
    authTicket: null,
    createdAt: 1_000,
    ...overrides,
  };
}

function outbox(msgId: string, overrides: Partial<NewOutbox> = {}): NewOutbox {
  return {
    id: `ob_${msgId}`,
    idempotencyKey: `key_${msgId}`,
    channel: "pull",
    deliveryClass: "business",
    taskId: "tsk_a",
    msgId,
    kind: "a2a_message",
    payloadHash: "hash",
    payloadJson: "{}",
    availableAt: 1_000,
    createdAt: 1_000,
    ...overrides,
  };
}

describe("a2a 线程与消息仓储", () => {
  it("线程按 (发起方任务, 收件方) 唯一", () => {
    const db = prepare();
    insertThread(db, thread());

    expect(findThreadById(db, "thr_1")).toMatchObject({ initiatorAgent: "agt_a" });
    expect(findThreadByInitiator(db, "tsk_a", "agt_b")?.id).toBe("thr_1");
    expect(findThreadByInitiator(db, "tsk_a", "agt_a")).toBeUndefined();
    expect(() => insertThread(db, thread({ id: "thr_dup" }))).toThrow(/UNIQUE/);
    db.close();
  });

  it("round 按线程单调,同线程同 round 唯一", () => {
    const db = prepare();
    insertThread(db, thread());
    expect(maxRound(db, "thr_1")).toBe(0);
    insertMessage(db, message());
    expect(maxRound(db, "thr_1")).toBe(1);
    expect(findMessageById(db, "msg_1")).toMatchObject({ round: 1, toAgent: "agt_b" });

    expect(() => insertMessage(db, message({ id: "msg_dup" }))).toThrow(/UNIQUE/);
    db.close();
  });

  it("ACK 只写一次,重复 ACK 返回 false", () => {
    const db = prepare();
    insertThread(db, thread());
    insertMessage(db, message());

    expect(markAck(db, "msg_1", 5_000)).toBe(true);
    expect(findMessageById(db, "msg_1")?.ackAt).toBe(5_000);
    expect(markAck(db, "msg_1", 6_000)).toBe(false);
    db.close();
  });

  it("信箱只返回发给自己、未 ACK 且出箱可见的消息", () => {
    const db = prepare();
    insertThread(db, thread());
    insertMessage(db, message({ id: "msg_visible", createdAt: 1_000 }));
    insertMessage(db, message({ id: "msg_acked", round: 2, createdAt: 2_000 }));
    insertMessage(db, message({ id: "msg_theirs", round: 3, toAgent: "agt_a", createdAt: 3_000 }));
    insertMessage(db, message({ id: "msg_future", round: 4, createdAt: 4_000 }));
    insertOutbox(db, outbox("msg_visible"));
    insertOutbox(db, outbox("msg_acked"));
    insertOutbox(db, outbox("msg_theirs", { taskId: "tsk_a" }));
    insertOutbox(db, outbox("msg_future", { availableAt: 9_000 }));
    markAck(db, "msg_acked", 5_000);

    expect(listInbox(db, "agt_b", { now: 1_000, limit: 10 }).map((row) => row.id)).toEqual([
      "msg_visible",
    ]);
    expect(listInbox(db, "agt_b", { now: 10_000, limit: 10 }).map((row) => row.id)).toEqual([
      "msg_visible",
      "msg_future",
    ]);
    db.close();
  });

  it("信箱游标按 (createdAt, id) 升序取下一页", () => {
    const db = prepare();
    insertThread(db, thread());
    insertMessage(db, message({ id: "msg_1", createdAt: 1_000 }));
    insertMessage(db, message({ id: "msg_2", round: 2, createdAt: 2_000 }));
    insertMessage(db, message({ id: "msg_3", round: 3, createdAt: 3_000 }));
    for (const id of ["msg_1", "msg_2", "msg_3"]) {
      insertOutbox(db, outbox(id));
    }

    const first = listInbox(db, "agt_b", { now: 1_000, limit: 2 });
    expect(first.map((row) => row.id)).toEqual(["msg_1", "msg_2"]);
    const second = listInbox(db, "agt_b", {
      now: 1_000,
      limit: 2,
      after: { createdAt: first[1]!.createdAt, id: first[1]!.id },
    });
    expect(second.map((row) => row.id)).toEqual(["msg_3"]);
    db.close();
  });
});
