import { describe, expect, it } from "vitest";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { findDeadLetterByMsgId, insertMessage, insertThread } from "../../store/repositories/a2a.js";
import { insertOutbox } from "../../store/repositories/outbox.js";
import { startDeadLetterSweeper } from "./dead-letter.js";

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
  for (const id of ["agt_a", "agt_b"]) {
    await db.run(
      `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
       VALUES (?, 'm1', ?, ?, 'hash', 'active', '[]', 0, 0)`,  id, id, id);
  }
  await db.run(
    `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('tsk_a', 'tsk_a', 'console', 'agt_a', 'aw', 'exec', 'running', 'a2a', 0, 0)`,
  );
  insertThread(db, {
    id: "thr_1",
    initiatorTaskId: "tsk_a",
    initiatorAgent: "agt_a",
    responderAgent: "agt_b",
    createdAt: 0,
  });
  insertMessage(db, {
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
    deadlineAt: 500,
    refsJson: "[]",
    authTicket: null,
    createdAt: 0,
  });
  insertOutbox(db, {
    id: "ob_1",
    idempotencyKey: "idem-1",
    channel: "pull",
    deliveryClass: "business",
    taskId: "tsk_a",
    msgId: "msg_1",
    kind: "a2a_message",
    payloadHash: "hash",
    payloadJson: "{}",
    availableAt: 0,
    createdAt: 0,
  });
  return db;
}

describe("startDeadLetterSweeper", () => {
  it("启动即扫一轮,转死信后记日志,stop 后不再扫", () => {
    const db = prepare();
    const logs: unknown[] = [];
    const logger = {
      info(obj: unknown) {
        logs.push(obj);
      },
      warn() {},
      error() {},
    };

    const sweeper = startDeadLetterSweeper(db, logger, {
      now: () => 1_000,
      intervalMs: 60_000,
    });

    expect(findDeadLetterByMsgId(db, "msg_1")).toMatchObject({ reason: "deadline_expired" });
    expect(logs).toEqual([{ deadLettered: 1, senders: ["agt_a"] }]);
    sweeper.stop();
    db.close();
  });
});
