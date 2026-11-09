import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAgent, type NewAgent } from "../../store/repositories/agent.js";
import { insertTask } from "../../store/repositories/task.js";
import {
  appendWorkItemEvent,
  findWorkItemById,
  insertWorkItem,
  listWorkItemEvents,
} from "../../store/repositories/work-item.js";
import { findInboxById, insertWorkerInboxIfNew } from "../../store/repositories/work-inbox.js";
import {
  reclaimZombiesOnce,
  startZombieReclaimer,
} from "./zombie-reclaim.js";

const NOW = 10_000_000;
const ZOMBIE_MS = 2 * 3_600_000;
const STALL_MS = 24 * 3_600_000;
const CHAT = "oc_collab_zombie";

const logger = {
  info(): void {},
  warn(): void {},
  error(): void {},
};

function agentRow(): NewAgent {
  return {
    id: "agt_w",
    machineId: null,
    runtime: "workbuddy",
    project: "demo",
    displayName: "Worker",
    secretHash: null,
    feishuAppId: null,
    allowedTargetsJson: "[]",
    createdAt: 1_000,
  };
}

interface Fixture {
  db: Db;
  run: (options?: { chatId?: string | undefined }) => Promise<{
    blocked: number;
    requeued: number;
    stalled: number;
  }>;
}

/** 铺一件僵尸场景:open 事项 + acked assignment + running 超时任务;assignment 建仓时间取近值,避免重排后立即被停滞升级命中 */
async function prepareZombie(options: {
  taskUpdatedAt: number;
  /** assignment 建仓时刻;默认近值 */
  inboxCreatedAt?: number;
}): Promise<Fixture> {
  const db = await openDatabase();
  await insertAgent(db, agentRow());
  await insertWorkItem(db, {
    id: "wim_1",
    project: "demo",
    kind: "bug_fix",
    title: "事项一",
    expectedResult: "修好",
    scopeJson: "{}",
    originTriggerId: null,
    authorizationKind: "none",
    authorizationRef: null,
    policyVersion: "test",
    createdAt: NOW - 4 * 3_600_000,
  });
  await insertWorkerInboxIfNew(db, {
    id: "wib_1",
    kind: "assignment",
    workItemId: "wim_1",
    triggerId: null,
    targetAgentId: "agt_w",
    idempotencyKey: "wib_1",
    payloadJson: "{}",
    createdAt: options.inboxCreatedAt ?? NOW - 3_600_000,
  });
  await insertTask(db, {
    id: "tsk_1",
    title: "承接任务",
    assigner: "router",
    assignee: "agt_w",
    project: "demo",
    parentTaskId: null,
    origin: "work_item",
    workItemId: "wim_1",
    deadlineAt: null,
    output: null,
    createdAt: options.taskUpdatedAt,
  });
  await db.run(
    "UPDATE task SET status = 'running', stage = 'exec', started_at = ?, updated_at = ? WHERE id = 'tsk_1'",
    options.taskUpdatedAt,
    options.taskUpdatedAt,
  );
  await db.run(
    "UPDATE worker_inbox SET status = 'acked', task_id = 'tsk_1' WHERE id = 'wib_1'",
  );
  let seq = 0;
  return {
    db,
    run: (overrides: { chatId?: string | undefined } = {}) =>
      reclaimZombiesOnce(
        {
          db,
          now: () => NOW,
          chatId: "chatId" in overrides ? overrides.chatId : CHAT,
          newEventId: () => `wev_z${++seq}`,
        },
        { zombieMs: ZOMBIE_MS, stallMs: STALL_MS },
        logger,
      ),
  };
}

async function outboxCount(db: Db): Promise<number> {
  const row = (await db.get("SELECT COUNT(*) AS n FROM outbox")) as { n: number };
  return row.n;
}

describe("僵尸任务回收 reclaimZombiesOnce", () => {
  it("超时 running → blocked,assignment 重排 pending,计数进事件", async () => {
    const fixture = await prepareZombie({ taskUpdatedAt: NOW - 3 * 3_600_000 });
    const result = await fixture.run();

    expect(result).toEqual({ blocked: 1, requeued: 1, stalled: 0 });
    const task = (await fixture.db.get(
      'SELECT status, ended_at AS "endedAt" FROM task WHERE id = \'tsk_1\'',
    )) as { status: string; endedAt: number | null };
    // ended_at 留空,与善后口径一致
    expect(task).toMatchObject({ status: "blocked", endedAt: null });
    const inbox = await findInboxById(fixture.db, "wib_1");
    expect(inbox).toMatchObject({ status: "pending", taskId: null, leaseToken: 1 });
    const kinds = (await listWorkItemEvents(fixture.db, "wim_1")).map((event) => event.kind);
    expect(kinds).toContain("requeued");
    const requeued = (await listWorkItemEvents(fixture.db, "wim_1")).find(
      (event) => event.kind === "requeued",
    );
    expect(JSON.parse(requeued?.payloadJson ?? "{}")).toMatchObject({
      inbox_id: "wib_1",
      attempt: 1,
    });
    const taskEvent = await fixture.db.get(
      "SELECT kind FROM task_event WHERE task_id = 'tsk_1'",
    );
    expect(taskEvent).toMatchObject({ kind: "blocked" });
    expect(await outboxCount(fixture.db)).toBe(1);
    await fixture.db.close();
  });

  it("重扫幂等:任务已 blocked 再跑无动作", async () => {
    const fixture = await prepareZombie({ taskUpdatedAt: NOW - 3 * 3_600_000 });
    await fixture.run();
    const again = await fixture.run();
    expect(again).toEqual({ blocked: 0, requeued: 0, stalled: 0 });
    expect(await outboxCount(fixture.db)).toBe(1);
    await fixture.db.close();
  });

  it("未超时的 running 不动", async () => {
    const fixture = await prepareZombie({ taskUpdatedAt: NOW - 3_600_000 });
    const result = await fixture.run();
    expect(result).toEqual({ blocked: 0, requeued: 0, stalled: 0 });
    const task = (await fixture.db.get("SELECT status FROM task WHERE id = 'tsk_1'")) as {
      status: string;
    };
    expect(task.status).toBe("running");
    await fixture.db.close();
  });

  it("重排达上限:不再重排,标记 attention=stalled", async () => {
    const fixture = await prepareZombie({ taskUpdatedAt: NOW - 3 * 3_600_000 });
    for (const n of [1, 2]) {
      await appendWorkItemEvent(fixture.db, {
        id: `wev_pre_${n}`,
        workItemId: "wim_1",
        kind: "requeued",
        triggerId: null,
        evidenceRefsJson: "[]",
        payloadJson: "{}",
        occurredAt: NOW - 100,
      });
    }
    const result = await fixture.run();

    expect(result).toEqual({ blocked: 1, requeued: 0, stalled: 1 });
    expect(await findInboxById(fixture.db, "wib_1")).toMatchObject({ status: "acked" });
    const item = await findWorkItemById(fixture.db, "wim_1");
    expect(item?.attention).toBe("stalled");
    const kinds = (await listWorkItemEvents(fixture.db, "wim_1")).map((event) => event.kind);
    expect(kinds).toContain("stalled");
    await fixture.db.close();
  });

  it("重排后不因旧建仓时间被立刻升级停滞", async () => {
    // assignment 建于 30h 前(已过 24h 停滞时限):重排把它退回 pending,
    // 但重排刷新了 updated_at,本轮不应把它判成「长期无人领取」
    const fixture = await prepareZombie({
      taskUpdatedAt: NOW - 3 * 3_600_000,
      inboxCreatedAt: NOW - 30 * 3_600_000,
    });
    const result = await fixture.run();

    expect(result).toEqual({ blocked: 1, requeued: 1, stalled: 0 });
    expect((await findWorkItemById(fixture.db, "wim_1"))?.attention).toBe("none");
    await fixture.db.close();
  });

  it("另有存活任务时不重排,assignment 原样", async () => {
    const fixture = await prepareZombie({ taskUpdatedAt: NOW - 3 * 3_600_000 });
    await insertTask(fixture.db, {
      id: "tsk_2",
      title: "返工任务",
      assigner: "console",
      assignee: "agt_w",
      project: "demo",
      parentTaskId: null,
      origin: "work_item",
      workItemId: "wim_1",
      deadlineAt: null,
      output: null,
      createdAt: NOW - 10,
    });
    const result = await fixture.run();

    expect(result).toEqual({ blocked: 1, requeued: 0, stalled: 0 });
    expect(await findInboxById(fixture.db, "wib_1")).toMatchObject({ status: "acked" });
    await fixture.db.close();
  });

  it("事项已收口:只回收不重排,事件只留 blocked", async () => {
    const fixture = await prepareZombie({ taskUpdatedAt: NOW - 3 * 3_600_000 });
    await fixture.db.run(
      "UPDATE work_item SET status = 'done', ended_at = ? WHERE id = 'wim_1'",
      NOW - 1,
    );
    const result = await fixture.run();

    expect(result).toEqual({ blocked: 1, requeued: 0, stalled: 0 });
    expect(await findInboxById(fixture.db, "wib_1")).toMatchObject({ status: "acked" });
    const kinds = (await listWorkItemEvents(fixture.db, "wim_1")).map((event) => event.kind);
    expect(kinds).not.toContain("requeued");
    await fixture.db.close();
  });

  it("群未配置:回收照常,不入队播报", async () => {
    const fixture = await prepareZombie({ taskUpdatedAt: NOW - 3 * 3_600_000 });
    const result = await fixture.run({ chatId: undefined });
    expect(result).toEqual({ blocked: 1, requeued: 1, stalled: 0 });
    expect(await outboxCount(fixture.db)).toBe(0);
    await fixture.db.close();
  });
});

describe("派工停滞升级", () => {
  async function preparePending(options: { createdAt: number }): Promise<Fixture> {
    const db = await openDatabase();
    await insertAgent(db, agentRow());
    await insertWorkItem(db, {
      id: "wim_1",
      project: "demo",
      kind: "bug_fix",
      title: "停滞事项",
      expectedResult: "修好",
      scopeJson: "{}",
      originTriggerId: null,
      authorizationKind: "none",
      authorizationRef: null,
      policyVersion: "test",
      createdAt: options.createdAt,
    });
    await insertWorkerInboxIfNew(db, {
      id: "wib_1",
      kind: "assignment",
      workItemId: "wim_1",
      triggerId: null,
      targetAgentId: "agt_w",
      idempotencyKey: "wib_1",
      payloadJson: "{}",
      createdAt: options.createdAt,
    });
    let seq = 0;
    return {
      db,
      run: (overrides: { chatId?: string | undefined } = {}) =>
        reclaimZombiesOnce(
          {
            db,
            now: () => NOW,
            chatId: "chatId" in overrides ? overrides.chatId : CHAT,
            newEventId: () => `wev_s${++seq}`,
          },
          { zombieMs: ZOMBIE_MS, stallMs: STALL_MS },
          logger,
        ),
    };
  }

  it("pending 超 24h → attention=stalled + 事件 + 播报;置位守卫不重复播", async () => {
    const fixture = await preparePending({ createdAt: NOW - STALL_MS - 1 });
    const first = await fixture.run();
    expect(first).toEqual({ blocked: 0, requeued: 0, stalled: 1 });
    expect((await findWorkItemById(fixture.db, "wim_1"))?.attention).toBe("stalled");
    const kinds = (await listWorkItemEvents(fixture.db, "wim_1")).map((event) => event.kind);
    expect(kinds).toContain("stalled");
    expect(await outboxCount(fixture.db)).toBe(1);

    const again = await fixture.run();
    expect(again).toEqual({ blocked: 0, requeued: 0, stalled: 0 });
    expect(await outboxCount(fixture.db)).toBe(1);
    await fixture.db.close();
  });

  it("未满时限的 pending 不升级", async () => {
    const fixture = await preparePending({ createdAt: NOW - 3_600_000 });
    const result = await fixture.run();
    expect(result).toEqual({ blocked: 0, requeued: 0, stalled: 0 });
    expect((await findWorkItemById(fixture.db, "wim_1"))?.attention).toBe("none");
    await fixture.db.close();
  });
});

describe("startZombieReclaimer", () => {
  it("随启动扫一轮,停机清定时器", async () => {
    const db = await openDatabase();
    const reclaimer = startZombieReclaimer(
      { db, now: () => NOW, chatId: undefined },
      logger,
      { zombieMs: ZOMBIE_MS, stallMs: STALL_MS, intervalMs: 60_000 },
    );
    reclaimer.stop();
    await db.close();
  });
});
