import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { findDeadLetterByMsgId, insertMessage, insertThread } from "../../store/repositories/a2a.js";
import { insertOutbox } from "../../store/repositories/outbox.js";
import { startDeadLetterSweeper } from "./dead-letter.js";

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
  await db.run(
    `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('tsk_a', 'tsk_a', 'console', 'agt_a', 'aw', 'exec', 'running', 'a2a', 0, 0)`,
  );
  await insertThread(db, {
    id: "thr_1",
    initiatorTaskId: "tsk_a",
    initiatorAgent: "agt_a",
    responderAgent: "agt_b",
    createdAt: 0,
  });
  await insertMessage(db, {
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
  await insertOutbox(db, {
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
  it("启动即扫一轮,转死信后记日志,stop 后不再扫", async () => {
    const db = await prepare();
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

    // 等待首次巡检完成（异步落库）
    await sweeper.initial;
    expect(await findDeadLetterByMsgId(db, "msg_1")).toMatchObject({ reason: "deadline_expired" });
    expect(logs).toEqual([{ deadLettered: 1, senders: ["agt_a"] }]);
    sweeper.stop();
    expect(logs).toEqual([{ deadLettered: 1, senders: ["agt_a"] }]);
    sweeper.stop();
    await db.close();
  });
});
