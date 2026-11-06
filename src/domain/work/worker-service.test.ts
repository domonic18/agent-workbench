import { describe, expect, it } from "vitest";
import { WORK_INBOX } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAgent } from "../../store/repositories/agent.js";
import { insertWorkItem, listWorkItemEvents } from "../../store/repositories/work-item.js";
import {
  claimPendingForAgent,
  findInboxById,
  insertWorkerInboxIfNew,
  reclaimExpiredInbox,
} from "../../store/repositories/work-inbox.js";
import { createTaskService } from "../task/service.js";
import { WorkError } from "./errors.js";
import { createWorkerService, type WorkerService } from "./worker-service.js";

const NOW = 10_000;

async function prepare(
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ db: Db; workers: WorkerService }> {
  const db = await openDatabase();
  for (const [id, runtime, displayName] of [
    ["agt_w", "workbuddy", "Worker"],
    ["agt_x", "codex", "Outsider"],
  ] as const) {
    await insertAgent(db, {
      id,
      machineId: null,
      runtime,
      project: "demo",
      displayName,
      secretHash: null,
      feishuAppId: null,
      allowedTargetsJson: "[]",
      createdAt: 1_000,
    });
  }
  let eventSeq = 0;
  const workers = createWorkerService({
    db,
    now: () => NOW,
    sleep: options.sleep ?? (async () => {}),
    newEventId: () => `wev_${++eventSeq}`,
  });
  return { db, workers };
}

function taskService(db: Db) {
  let seq = 0;
  return createTaskService({
    db,
    now: () => NOW,
    newTaskId: () => `tsk_${++seq}`,
    newEventId: () => `tev_${++seq}`,
  });
}

async function seedItem(db: Db, id: string, project = "demo"): Promise<void> {
  await insertWorkItem(db, {
    id,
    project,
    kind: "bug_fix",
    title: `事项 ${id}`,
    expectedResult: "修好",
    scopeJson: "{}",
    originTriggerId: null,
    authorizationKind: "none",
    authorizationRef: null,
    policyVersion: "test",
    createdAt: NOW,
  });
}

async function seedInbox(
  db: Db,
  overrides: { id: string; workItemId: string; kind: "assignment" | "input"; target?: string },
): Promise<void> {
  await insertWorkerInboxIfNew(db, {
    id: overrides.id,
    kind: overrides.kind,
    workItemId: overrides.workItemId,
    triggerId: null,
    targetAgentId: overrides.target ?? "agt_w",
    idempotencyKey: overrides.id,
    payloadJson: "{}",
    createdAt: NOW,
  });
}

async function expectCode(fn: () => Promise<unknown>, code: WorkError["code"]): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkError);
    expect((error as WorkError).code).toBe(code);
    return;
  }
  throw new Error("预期抛出 WorkError,实际未抛出");
}

describe("worker inbox 领取", () => {
  it("peek 只看不领:返回 pending 行且状态不变,随后正常领取仍可命中", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "assignment" });

    const peeked = await workers.inbox("agt_w", { peek: true });
    expect(peeked).toHaveLength(1);
    expect(peeked[0]?.inbox).toMatchObject({ id: "wib_1", status: "pending", leaseUntil: null });
    expect(peeked[0]?.workItem.title).toBe("事项 wim_1");
    // 不占租约:行仍 pending,再次 peek 仍可见,正常领取照常 claim
    expect(await workers.inbox("agt_w", { peek: true })).toHaveLength(1);
    const claimed = await workers.inbox("agt_w", {});
    expect(claimed[0]?.inbox).toMatchObject({ id: "wib_1", status: "claimed" });
    // 已领取的行不再出现在 peek(peek 只看 pending)
    expect(await workers.inbox("agt_w", { peek: true })).toEqual([]);
    await db.close();
  });

  it("领取即持租约,再领为空", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "assignment" });

    const claimed = await workers.inbox("agt_w", {});
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.workItem.title).toBe("事项 wim_1");
    expect(claimed[0]?.inbox).toMatchObject({
      id: "wib_1",
      status: "claimed",
      leaseToken: 1,
      leaseUntil: NOW + WORK_INBOX.leaseMs,
    });
    expect(await workers.inbox("agt_w", {})).toEqual([]);
    await db.close();
  });

  it("只领取指向自己的行", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "assignment", target: "agt_x" });

    expect(await workers.inbox("agt_w", {})).toEqual([]);
    expect((await findInboxById(db, "wib_1"))?.status).toBe("pending");
    await db.close();
  });

  it("长轮询在等待期出现新行时返回", async () => {
    const { db, workers } = await prepare({
      sleep: async () => {
        await seedItem(db, "wim_1");
        await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "input" });
      },
    });

    const claimed = await workers.inbox("agt_w", { waitMs: 5_000 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.inbox.kind).toBe("input");
    await db.close();
  });
});

describe("worker read 权限", () => {
  it("承接者可读事项与事件;外人知道 ID 也读不到", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "assignment" });
    await workers.inbox("agt_w", {});

    const read = await workers.read("agt_w", "wim_1");
    expect(read.item).toMatchObject({ id: "wim_1", expectedResult: "修好" });
    expect(read.events).toEqual([]);
    await expectCode(() => workers.read("agt_x", "wim_1"), "FORBIDDEN");
    await expectCode(() => workers.read("agt_w", "wim_missing"), "NOT_FOUND");
    await db.close();
  });
});

describe("worker ack", () => {
  it("assignment 带归属正确的任务 ACK,绑定落事件", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "assignment" });
    await workers.inbox("agt_w", {});

    const task = await taskService(db).create({
      title: "修登录页",
      assigner: "router",
      project: "demo",
      assignee: "agt_w",
      workItemId: "wim_1",
    });
    expect(task.origin).toBe("work_item");
    expect(task.workItemId).toBe("wim_1");

    await workers.ack("agt_w", "wib_1", task.id);
    expect(await findInboxById(db, "wib_1")).toMatchObject({ status: "acked", taskId: task.id });
    expect((await listWorkItemEvents(db, "wim_1")).map((event) => event.kind)).toEqual([
      "task_bound",
    ]);
    await db.close();
  });

  it("assignment 缺 task_id 拒绝且行保持 claimed 等重投", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "assignment" });
    await workers.inbox("agt_w", {});

    await expectCode(() => workers.ack("agt_w", "wib_1", null), "VALIDATION_FAILED");
    expect((await findInboxById(db, "wib_1"))?.status).toBe("claimed");
    await db.close();
  });

  it("任务归属/来源/事项不一致均拒绝", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedItem(db, "wim_2");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "assignment" });
    await seedInbox(db, { id: "wib_2", workItemId: "wim_2", kind: "assignment" });
    await workers.inbox("agt_w", {});

    const tasks = taskService(db);
    const plain = await tasks.create({
      title: "普通任务",
      assigner: "console",
      project: "demo",
      assignee: "agt_w",
    });
    const other = await tasks.create({
      title: "另一事项的任务",
      assigner: "console",
      project: "demo",
      assignee: "agt_w",
      workItemId: "wim_2",
    });

    await expectCode(() => workers.ack("agt_w", "wib_1", plain.id), "VALIDATION_FAILED");
    await expectCode(() => workers.ack("agt_w", "wib_1", other.id), "VALIDATION_FAILED");
    await expectCode(() => workers.ack("agt_x", "wib_1", other.id), "FORBIDDEN");
    await expectCode(() => workers.ack("agt_w", "wib_1", "tsk_missing"), "NOT_FOUND");
    expect((await findInboxById(db, "wib_1"))?.status).toBe("claimed");
    await db.close();
  });

  it("input ACK 不带 task_id,带则拒绝", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "input" });
    await workers.inbox("agt_w", {});

    await expectCode(() => workers.ack("agt_w", "wib_1", "tsk_1"), "VALIDATION_FAILED");
    await workers.ack("agt_w", "wib_1", null);
    expect((await findInboxById(db, "wib_1"))?.status).toBe("acked");
    await db.close();
  });
});

describe("worker handback 与租约", () => {
  it("单事件退回:行 handed_back、理由落事件,不退订 Thread", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "input" });
    await workers.inbox("agt_w", {});

    await expectCode(() => workers.handback("agt_w", "wib_1", "  "), "VALIDATION_FAILED");
    await workers.handback("agt_w", "wib_1", "超出原 Mandate 范围");
    expect(await findInboxById(db, "wib_1")).toMatchObject({
      status: "handed_back",
      reason: "超出原 Mandate 范围",
    });
    const last = (await listWorkItemEvents(db, "wim_1")).at(-1);
    expect(last).toMatchObject({ kind: "handback" });
    expect(JSON.parse(last?.payloadJson ?? "{}")).toMatchObject({ inbox_id: "wib_1" });
    await db.close();
  });

  it("过期租约回收只改状态不建行,重投可再领取", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "assignment" });
    await workers.inbox("agt_w", {});

    const reclaimed = await reclaimExpiredInbox(db, NOW + WORK_INBOX.leaseMs + 1);
    expect(reclaimed).toBe(1);
    expect(await findInboxById(db, "wib_1")).toMatchObject({ status: "pending", leaseToken: 2 });
    expect(await db.get("SELECT COUNT(*) AS n FROM worker_inbox")).toEqual({ n: 1 });

    const again = await claimPendingForAgent(db, "agt_w", NOW * 2, NOW * 3);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: "wib_1", status: "claimed", leaseToken: 3 });
    await db.close();
  });

  it("ACK 竞争失败映射 CONFLICT(租约已被回收重投)", async () => {
    const { db, workers } = await prepare();
    await seedItem(db, "wim_1");
    await seedInbox(db, { id: "wib_1", workItemId: "wim_1", kind: "input" });
    await workers.inbox("agt_w", {});
    await reclaimExpiredInbox(db, NOW + WORK_INBOX.leaseMs + 1);

    await expectCode(() => workers.ack("agt_w", "wib_1", null), "CONFLICT");
    await db.close();
  });
});
