import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { findDeadLetterByMsgId, findMessageById } from "../../store/repositories/a2a.js";
import { findOutboxByKey } from "../../store/repositories/outbox.js";
import { sweepDeadLetters } from "./dead-letter.js";
import { A2aError } from "./errors.js";
import { createA2aService } from "./service.js";
import type { A2aSendInput, A2aService } from "./types.js";

const NOW = 1_000;

async function prepare(): Promise<{ db: Db; service: A2aService; setNow: (value: number) => void }> {
  const db = await openDatabase();
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
  for (const id of ["agt_a", "agt_b"]) {
    await db.run(
      `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
       VALUES (?, 'm1', ?, ?, 'hash', 'active', ?, 0, 0)`,
      id, id, id, JSON.stringify(["agt_a", "agt_b"]),
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
  let msgSeq = 0;
  let threadSeq = 0;
  let currentNow = NOW;
  const service = createA2aService({
    db,
    now: () => currentNow,
    newMsgId: () => `msg_${++msgSeq}`,
    newThreadId: () => `thr_${++threadSeq}`,
    newTaskEventId: () => "tev_1",
    waitMs: 0,
  });
  return { db, service, setNow: (value) => { currentNow = value; } };
}

function sendInput(overrides: Partial<A2aSendInput> = {}): A2aSendInput {
  return {
    idempotencyKey: "idem-1",
    fromAgentId: "agt_a",
    taskId: "tsk_a",
    to: "agt_b",
    intent: "request",
    summary: "需要一份接口契约",
    expect: "OpenAPI 片段",
    deadlineAt: 10_000,
    refs: [],
    authTicketId: null,
    ...overrides,
  };
}

describe("a2a 死信巡检", () => {
  it("过期未 ACK → 出箱 failed、写死信并回执发起方", async () => {
    const { db, service } = await prepare();
    await service.send(sendInput());
    const woken: string[] = [];
    let msgSeq = 1;

    const result = await sweepDeadLetters({
      db,
      now: () => 20_000,
      newMsgId: () => `msg_${++msgSeq}`,
      newDeadLetterId: () => "dlq_1",
      wake: (agentId) => woken.push(agentId),
    });

    expect(result).toEqual({ deadLettered: 1, senders: ["agt_a"] });
    expect(woken).toEqual(["agt_a"]);
    expect((await findOutboxByKey(db, "a2a:agt_a:idem-1"))?.status).toBe("failed");
    expect(await findDeadLetterByMsgId(db, "msg_1")).toMatchObject({
      fromAgent: "agt_a",
      toAgent: "agt_b",
      taskId: "tsk_a",
      reason: "deadline_expired",
    });
    expect(JSON.parse((await findDeadLetterByMsgId(db, "msg_1"))?.payloadJson ?? "{}")).toMatchObject({
      msg_id: "msg_1",
      task_id: "tsk_a",
    });

    expect(await findMessageById(db, "msg_2")).toMatchObject({
      threadId: "thr_1",
      taskId: "tsk_a",
      round: 2,
      replyToMsgId: "msg_1",
      fromAgent: "agt_b",
      toAgent: "agt_a",
      intent: "notify",
      summary: "消息已过期未确认,请重新发起",
      deadlineAt: null,
    });
    expect(await findOutboxByKey(db, "a2a_receipt:msg_1")).toMatchObject({
      channel: "pull",
      deliveryClass: "business",
      msgId: "msg_2",
      status: "pending",
    });
    await db.close();
  });

  it("未到期、已 ACK、notify 无 deadline 都不转死信", async () => {
    const { db, service } = await prepare();
    await service.send(sendInput({ idempotencyKey: "idem-later", deadlineAt: 30_000 }));
    await service.send(sendInput({ idempotencyKey: "idem-acked" }));
    await service.ack("agt_b", "msg_2", { taskId: "tsk_b" });
    await service.send(
      sendInput({ idempotencyKey: "idem-notify", intent: "notify", deadlineAt: null }),
    );

    const result = await sweepDeadLetters({ db, now: () => 20_000 });

    expect(result).toEqual({ deadLettered: 0, senders: [] });
    expect(await findDeadLetterByMsgId(db, "msg_1")).toBeUndefined();
    expect((await findOutboxByKey(db, "a2a:agt_a:idem-acked"))?.status).toBe("delivered");
    expect(await db.get("SELECT COUNT(*) AS n FROM a2a_dead_letter")).toEqual({ n: 0 });
    await db.close();
  });

  it("重复巡检不重复写死信与回执", async () => {
    const { db, service } = await prepare();
    await service.send(sendInput());
    let msgSeq = 1;
    const deps = {
      db,
      now: () => 20_000,
      newMsgId: () => `msg_${++msgSeq}`,
      newDeadLetterId: () => `dlq_${++msgSeq}`,
    };

    expect((await sweepDeadLetters(deps)).deadLettered).toBe(1);
    expect(await sweepDeadLetters(deps)).toEqual({ deadLettered: 0, senders: [] });
    expect(await db.get("SELECT COUNT(*) AS n FROM a2a_dead_letter")).toEqual({ n: 1 });
    expect(await db.get("SELECT COUNT(*) AS n FROM a2a_message")).toEqual({ n: 2 });
    await db.close();
  });

  it("进死信后迟到的 ACK 返回 CONFLICT", async () => {
    const { db, service } = await prepare();
    await service.send(sendInput());
    await sweepDeadLetters({ db, now: () => 20_000 });

    try {
      await service.ack("agt_b", "msg_1", { taskId: "tsk_b" });
      throw new Error("预期抛出 CONFLICT");
    } catch (error) {
      expect(error).toBeInstanceOf(A2aError);
      expect((error as A2aError).code).toBe("CONFLICT");
    }
    expect((await findMessageById(db, "msg_1"))?.ackAt).toBeNull();
    await db.close();
  });
});
