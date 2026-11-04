import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { findMessageById } from "../../store/repositories/a2a.js";
import { findOutboxByKey, insertOutbox, reconcileStaleLeases } from "../../store/repositories/outbox.js";
import { A2aError } from "./errors.js";
import { createA2aService } from "./service.js";
import type { A2aSendInput, A2aService } from "./types.js";

const NOW = 1_000;
const LEASE_MS = 30_000;

async function prepare(): Promise<{
  db: Db;
  service: A2aService;
  setNow: (value: number) => void;
}> {
  const db = await openDatabase();
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
  const agents: [string, string[]][] = [
    ["agt_a", ["agt_b", "agt_c"]],
    ["agt_b", ["agt_a"]],
    ["agt_c", []],
  ];
  for (const [id, targets] of agents) {
    await db.run(
      `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
       VALUES (?, 'm1', ?, ?, 'hash', 'active', ?, 0, 0)`,
      id, id, id, JSON.stringify(targets),
    );
  }
  const tasks: [string, string][] = [
    ["tsk_a", "agt_a"],
    ["tsk_b", "agt_b"],
    ["tsk_b2", "agt_b"],
    ["tsk_c", "agt_c"],
  ];
  for (const [id, assignee] of tasks) {
    await db.run(
      `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
       VALUES (?, ?, 'console', ?, 'aw', 'exec', 'running', 'a2a', 0, 0)`,
      id, id, assignee,
    );
  }
  let msgSeq = 0;
  let threadSeq = 0;
  let eventSeq = 0;
  let currentNow = NOW;
  const service = createA2aService({
    db,
    now: () => currentNow,
    newMsgId: () => `msg_${++msgSeq}`,
    newThreadId: () => `thr_${++threadSeq}`,
    newTaskEventId: () => `tev_${++eventSeq}`,
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

async function expectCode(fn: () => Promise<unknown>, code: A2aError["code"]): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(A2aError);
    expect((error as A2aError).code).toBe(code);
    return;
  }
  throw new Error(`预期抛出 ${code}`);
}

describe("a2a send", () => {
  it("首条消息建线程、分配 round 1,并落 pull 出箱行", async () => {
    const { db, service } = await prepare();
    const result = await service.send(sendInput());

    expect(result).toEqual({ msgId: "msg_1", threadId: "thr_1", round: 1 });
    expect(await findMessageById(db, "msg_1")).toMatchObject({
      threadId: "thr_1",
      taskId: "tsk_a",
      fromAgent: "agt_a",
      toAgent: "agt_b",
      round: 1,
    });
    expect(await findOutboxByKey(db, "idem-1")).toMatchObject({
      channel: "pull",
      deliveryClass: "business",
      msgId: "msg_1",
      taskId: "tsk_a",
      status: "pending",
    });
    await db.close();
  });

  it("同 (发起方任务, 收件方) 复用线程并递增 round", async () => {
    const { db, service } = await prepare();
    await service.send(sendInput());
    const second = await service.send(sendInput({ idempotencyKey: "idem-2" }));

    expect(second.threadId).toBe("thr_1");
    expect(second.round).toBe(2);
    expect(await db.get("SELECT COUNT(*) AS n FROM a2a_message")).toEqual({ n: 2 });
    await db.close();
  });

  it("收件方带 thread_id 续接线程,只能发回另一方", async () => {
    const { service, db } = await prepare();
    await service.send(sendInput());
    const reply = await service.send(
      sendInput({
        idempotencyKey: "idem-reply",
        fromAgentId: "agt_b",
        taskId: "tsk_b",
        to: "agt_a",
        intent: "reply",
        deadlineAt: 10_000,
        threadId: "thr_1",
      }),
    );
    expect(reply).toMatchObject({ threadId: "thr_1", round: 2 });

    await expectCode(
      () =>
        service.send(
          sendInput({
            idempotencyKey: "idem-wrong",
            fromAgentId: "agt_b",
            taskId: "tsk_b",
            to: "agt_c",
            threadId: "thr_1",
          }),
        ),
      "FORBIDDEN",
    );
    await db.close();
  });

  it("同 Idempotency-Key 返回首次 msg_id 且不重复落库", async () => {
    const { db, service } = await prepare();
    const first = await service.send(sendInput());
    const again = await service.send(sendInput({ summary: "换个说法也是同一条" }));

    expect(again).toEqual(first);
    expect(await db.get("SELECT COUNT(*) AS n FROM a2a_message")).toEqual({ n: 1 });
    await db.close();
  });

  it("白名单拒绝时回带可达目标", async () => {
    const { db, service } = await prepare();
    try {
      await service.send(sendInput({ fromAgentId: "agt_b", taskId: "tsk_b", to: "agt_c" }));
      throw new Error("预期被白名单拒绝");
    } catch (error) {
      expect(error).toBeInstanceOf(A2aError);
      expect((error as A2aError).code).toBe("FORBIDDEN");
      expect((error as A2aError).detail).toEqual({ allowedTargets: ["agt_a"] });
    }
    await db.close();
  });

  it("目标不在白名单、未注册、任务不属于自己都拒绝", async () => {
    const { service, db } = await prepare();
    await expectCode(
      () => service.send(sendInput({ fromAgentId: "agt_c", taskId: "tsk_c", to: "agt_a" })),
      "FORBIDDEN",
    );
    await expectCode(() => service.send(sendInput({ to: "agt_missing" })), "NOT_FOUND");
    await expectCode(() => service.send(sendInput({ taskId: "tsk_b" })), "FORBIDDEN");
    await expectCode(() => service.send(sendInput({ taskId: "tsk_missing" })), "NOT_FOUND");
    await db.close();
  });

  it("任务存在 uncertain 业务出箱行时冻结新发送", async () => {
    const { db, service } = await prepare();
    await insertOutbox(db, {
      id: "ob_fence",
      idempotencyKey: "fence",
      channel: "pull",
      deliveryClass: "business",
      taskId: "tsk_a",
      msgId: null,
      kind: "a2a_message",
      payloadHash: "hash",
      payloadJson: "{}",
      availableAt: 0,
      createdAt: 0,
    });
    await db.run("UPDATE outbox SET status = 'uncertain' WHERE id = 'ob_fence'");

    await expectCode(() => service.send(sendInput()), "CONFLICT");
    await db.close();
  });

  it("reply_to 必须指向同线程消息", async () => {
    const { service, db } = await prepare();
    const other = await service.send(
      sendInput({ idempotencyKey: "idem-c", to: "agt_c", summary: "另一线程" }),
    );
    await expectCode(
      () => service.send(sendInput({ idempotencyKey: "idem-b", replyToMsgId: other.msgId })),
      "VALIDATION_FAILED",
    );
    await db.close();
  });
});

describe("a2a inbox", () => {
  it("拉取即领取,重复拉取为空,租约过期后重新可见", async () => {
    const { db, service, setNow } = await prepare();
    await service.send(sendInput());

    const first = await service.inbox("agt_b");
    expect(first.items.map((item) => item.msg_id)).toEqual(["msg_1"]);
    expect(first.items[0]).toMatchObject({
      from: "agt_a",
      to: "agt_b",
      intent: "request",
      deadline: new Date(10_000).toISOString(),
    });

    expect((await service.inbox("agt_b")).items).toEqual([]);
    setNow(NOW + LEASE_MS + 1);
    await reconcileStaleLeases(db, NOW + LEASE_MS + 1);
    expect((await service.inbox("agt_b")).items.map((item) => item.msg_id)).toEqual(["msg_1"]);
    await db.close();
  });

  it("空信箱挂起时被新消息唤醒", async () => {
    const { service, db } = await prepare();
    const pending = service.inbox("agt_b", { waitMs: 1_000 });
    await service.send(sendInput());

    const result = await pending;
    expect(result.items.map((item) => item.msg_id)).toEqual(["msg_1"]);
    await db.close();
  });

  it("非法 cursor 返回 422 语义", async () => {
    const { service } = await prepare();
    await expect(service.inbox("agt_b", { cursor: "bad" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("a2a ack", () => {
  it("ACK request 同事务写下游 parent_task_id 与 handoff 事件", async () => {
    const { db, service } = await prepare();
    await service.send(sendInput());

    await service.ack("agt_b", "msg_1", { taskId: "tsk_b2" });

    const task = (await db.get(
      'SELECT parent_task_id AS "parentTaskId" FROM task WHERE id = \'tsk_b2\'',
    )) as { parentTaskId: string | null };
    expect(task.parentTaskId).toBe("tsk_a");
    expect((await findMessageById(db, "msg_1"))?.ackAt).toBe(NOW);
    expect((await findOutboxByKey(db, "idem-1"))?.status).toBe("delivered");

    const event = (await db.get(
      "SELECT kind, payload_json AS payload FROM task_event WHERE task_id = 'tsk_b2'",
    )) as { kind: string; payload: string };
    expect(event.kind).toBe("handoff");
    expect(JSON.parse(event.payload)).toMatchObject({
      relation: "a2a",
      upstream_msg_id: "msg_1",
      upstream_task_id: "tsk_a",
    });

    await service.ack("agt_b", "msg_1", { taskId: "tsk_b2" });
    expect(await db.get("SELECT COUNT(*) AS n FROM task_event")).toEqual({ n: 1 });
    await db.close();
  });

  it("ACK request 缺 task_id / 任务不属于自己都拒绝", async () => {
    const { service, db } = await prepare();
    await service.send(sendInput());

    await expectCode(() => service.ack("agt_b", "msg_1"), "VALIDATION_FAILED");
    await expectCode(() => service.ack("agt_b", "msg_1", { taskId: "tsk_a" }), "FORBIDDEN");
    await expectCode(() => service.ack("agt_a", "msg_1", { taskId: "tsk_b2" }), "FORBIDDEN");
    await expectCode(() => service.ack("agt_b", "msg_missing"), "NOT_FOUND");
    await db.close();
  });

  it("ACK reply / notify 不收 task_id,不写链路", async () => {
    const { db, service } = await prepare();
    await service.send(sendInput());
    await service.send(
      sendInput({
        idempotencyKey: "idem-reply",
        fromAgentId: "agt_b",
        taskId: "tsk_b",
        to: "agt_a",
        intent: "reply",
        threadId: "thr_1",
      }),
    );

    await service.ack("agt_a", "msg_2");
    expect((await findMessageById(db, "msg_2"))?.ackAt).toBe(NOW);
    expect(await db.get("SELECT COUNT(*) AS n FROM task_event")).toEqual({ n: 0 });
    expect(
      await db.get("SELECT parent_task_id AS p FROM task WHERE id = 'tsk_b'"),
    ).toEqual({ p: null });
    await db.close();
  });
});

describe("handoffNotice", () => {
  it("request 返回参与方(播报由控制台直发,不再带 bot open_id)", async () => {
    const { service, db } = await prepare();
    const { msgId } = await service.send(sendInput());

    expect(await service.handoffNotice(msgId)).toEqual({
      msgId: "msg_1",
      taskId: "tsk_a",
      threadId: "thr_1",
      summary: "需要一份接口契约",
      from: { id: "agt_a", displayName: "agt_a" },
      to: { id: "agt_b", displayName: "agt_b" },
    });
    await db.close();
  });

  it("reply 与未知消息返回 null", async () => {
    const { service, db } = await prepare();
    await service.send(sendInput());
    const reply = await service.send(
      sendInput({
        idempotencyKey: "idem-2",
        fromAgentId: "agt_b",
        taskId: "tsk_b",
        to: "agt_a",
        intent: "reply",
        threadId: "thr_1",
      }),
    );

    expect(await service.handoffNotice(reply.msgId)).toBeNull();
    expect(await service.handoffNotice("msg_missing")).toBeNull();
    await db.close();
  });
});
