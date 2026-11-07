import { describe, expect, it } from "vitest";
import { RUN_IDLE_GAP_MS, type TaskEventKind } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import {
  bindRunTaskIfEmpty,
  findRunById,
  insertRun,
} from "../../store/repositories/run.js";
import { findTaskById } from "../../store/repositories/task.js";
import { insertWorkItem } from "../../store/repositories/work-item.js";
import { insertWorkerInboxIfNew } from "../../store/repositories/work-inbox.js";
import { TaskError } from "./errors.js";
import { createTaskService, type TaskCreateInput, type TaskService } from "./service.js";

const NOW = 1_000;

async function prepare(options: { now?: () => number } = {}): Promise<{
  db: Db;
  service: TaskService;
}> {
  const db = await openDatabase();
  let taskSeq = 0;
  let eventSeq = 0;
  const service = createTaskService({
    db,
    now: options.now ?? (() => NOW),
    newTaskId: () => `tsk_${++taskSeq}`,
    newEventId: () => `tev_${++eventSeq}`,
  });
  return { db, service };
}

async function addRun(db: Db, id: string, lastSeenAt: number): Promise<void> {
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'h', 'active', 0) ON CONFLICT DO NOTHING",
  );
  await db.run(
    `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
     VALUES ('agt_a', 'm1', 'aw', 'agt_a', 'h', 'active', '[]', 0, 0) ON CONFLICT DO NOTHING`,
  );
  await insertRun(db, {
    id,
    agentId: "agt_a",
    machine: "m1",
    project: "aw",
    streamId: `s-${id}`,
    startedAt: lastSeenAt,
  });
  await db.run("UPDATE agent_run SET last_seen_at = ? WHERE id = ?", lastSeenAt, id);
}

function createInput(overrides: Partial<TaskCreateInput> = {}): TaskCreateInput {
  return {
    title: "整理接口契约",
    assigner: "console",
    project: "aw",
    assignee: "agt_a",
    ...overrides,
  };
}

async function events(db: Db, taskId: string): Promise<{ kind: TaskEventKind; payload: unknown }[]> {
  return (await db.all(
    'SELECT kind, payload_json AS payload FROM task_event WHERE task_id = ? ORDER BY seq',
    taskId,
  )) as { kind: TaskEventKind; payload: string }[];
}

async function expectCode(fn: () => Promise<unknown>, code: TaskError["code"]): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TaskError);
    expect((error as TaskError).code).toBe(code);
    return;
  }
  throw new Error("预期抛出 TaskError,实际未抛出");
}

/** 在服务读取与 CAS 写入之间注入一次并发改写,模拟「读后被抢先」 */
function interceptBeforeTransaction(db: Db, action: () => Promise<void>): Db {
  return {
    query: (sql, params) => db.query(sql, params),
    get: (sql, ...p) => db.get(sql, ...p),
    all: (sql, ...p) => db.all(sql, ...p),
    run: (sql, ...p) => db.run(sql, ...p),
    exec: (sql) => db.exec(sql),
    transaction: async (fn) => {
      await action();
      return db.transaction(fn);
    },
    close: () => db.close(),
  };
}

describe("createTaskService.create", () => {
  it("从 intake/pending 起跑并写 created 事件", async () => {
    const { db, service } = await prepare();
    const task = await service.create(createInput({ output: "kb_notes", deadlineAt: 9_000 }));

    expect(task).toMatchObject({
      title: "整理接口契约",
      assigner: "console",
      assignee: "agt_a",
      project: "aw",
      parentTaskId: null,
      round: 1,
      reworkCount: 0,
      stage: "intake",
      status: "pending",
      origin: "a2a",
      output: "kb_notes",
      deadlineAt: 9_000,
      startedAt: null,
      endedAt: null,
      totalTokens: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await events(db, task.id)).toEqual([
      { kind: "created", payload: JSON.stringify({ origin: "a2a", assigner: "console", project: "aw" }) },
    ]);
    await db.close();
  });

  it("续接父任务写 handoff(relation=continuation)", async () => {
    const { db, service } = await prepare();
    const parent = await service.create(createInput());
    const child = await service.create(createInput({ title: "续接", parentTaskId: parent.id }));

    expect(child.parentTaskId).toBe(parent.id);
    expect(await events(db, child.id)).toEqual([
      expect.objectContaining({ kind: "created" }),
      {
        kind: "handoff",
        payload: JSON.stringify({ relation: "continuation", from_task_id: parent.id }),
      },
    ]);
    await db.close();
  });

  it("父任务不存在 404,非本人 403", async () => {
    const { service, db } = await prepare();
    await expectCode(() => service.create(createInput({ parentTaskId: "tsk_404" })), "NOT_FOUND");

    const other = await service.create(createInput({ assignee: "agt_b" }));
    await expectCode(() => service.create(createInput({ parentTaskId: other.id })), "FORBIDDEN");
    await db.close();
  });

  it("output 非法 422 且不落库", async () => {
    const { db, service } = await prepare();
    await expectCode(() => service.create(createInput({ output: "自由文本" })), "VALIDATION_FAILED");
    expect(await db.get("SELECT COUNT(*) AS n FROM task")).toEqual({ n: 0 });
    await db.close();
  });

  it("建单绑定调用方最近活跃的未归属 run", async () => {
    const { db, service } = await prepare();
    await addRun(db, "run_old", NOW - 100);
    await addRun(db, "run_new", NOW - 50);

    const task = await service.create(createInput());

    expect((await findRunById(db, "run_new"))?.taskId).toBe(task.id);
    expect((await findRunById(db, "run_old"))?.taskId).toBeNull();
    await db.close();
  });

  it("已归属任务的 run 不被抢占,空闲超窗的 run 不参与绑定", async () => {
    const at = NOW + RUN_IDLE_GAP_MS + 1;
    const { db, service } = await prepare({ now: () => at });
    await db.run(
      "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'h', 'active', 0)",
    );
    await db.run(
      `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
       VALUES ('agt_a', 'm1', 'aw', 'agt_a', 'h', 'active', '[]', 0, 0)`,
    );
    await db.run(
      `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
       VALUES ('tsk_other', 'tsk_other', 'console', 'agt_a', 'aw', 'intake', 'pending', 'a2a', 0, 0)`,
    );
    await addRun(db, "run_bound", at - 50);
    expect(await bindRunTaskIfEmpty(db, "run_bound", "tsk_other")).toBe(true);
    await addRun(db, "run_stale", NOW);

    const task = await service.create(createInput());

    expect((await findRunById(db, "run_bound"))?.taskId).toBe("tsk_other");
    expect((await findRunById(db, "run_stale"))?.taskId).toBeNull();
    expect(task.id).not.toBe("tsk_other");
    await db.close();
  });
});

describe("createTaskService.update", () => {
  it("按状态机推进并写事件,review→running 记返工", async () => {
    const { db, service } = await prepare();
    const created = await service.create(createInput());

    const running = await service.update({
      taskId: created.id,
      assignee: "agt_a",
      stage: "plan",
      status: "running",
    });
    expect(running.task).toMatchObject({ stage: "plan", status: "running", startedAt: NOW });
    expect(running.autoClosed).toEqual([]);

    await service.update({ taskId: created.id, assignee: "agt_a", stage: "exec", status: "review" });
    const reworked = await service.update({
      taskId: created.id,
      assignee: "agt_a",
      status: "running",
      reason: "评审发现边界遗漏",
    });
    expect(reworked.task).toMatchObject({ status: "running", reworkCount: 1 });

    expect((await events(db, created.id)).map((event) => event.kind)).toEqual([
      "created",
      "stage_changed",
      "resumed",
      "stage_changed",
      "rework",
    ]);
    expect((await events(db, created.id)).at(-1)?.payload).toContain("评审发现边界遗漏");
    await db.close();
  });

  it("阻塞事件携带原因", async () => {
    const { db, service } = await prepare();
    const created = await service.create(createInput());
    await service.update({ taskId: created.id, assignee: "agt_a", status: "running" });
    await service.update({
      taskId: created.id,
      assignee: "agt_a",
      status: "blocked",
      reason: "等待审批补签",
    });

    expect((await events(db, created.id)).at(-1)?.payload).toContain("等待审批补签");
    await db.close();
  });

  it("非法状态跃迁 422,非本人 403,不存在 404", async () => {
    const { db, service } = await prepare();
    const created = await service.create(createInput());

    await expectCode(
      () => service.update({ taskId: created.id, assignee: "agt_a", status: "done" }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      () => service.update({ taskId: created.id, assignee: "agt_b", status: "running" }),
      "FORBIDDEN",
    );
    await expectCode(
      () => service.update({ taskId: "tsk_404", assignee: "agt_a", status: "running" }),
      "NOT_FOUND",
    );
    await db.close();
  });

  it("读后被抢先修改即 CONFLICT", async () => {
    const raw = await openDatabase();
    let taskSeq = 0;
    let eventSeq = 0;
    const service = createTaskService({
      db: interceptBeforeTransaction(raw, async () => {
        await raw.run("UPDATE task SET status = 'blocked' WHERE id = 'tsk_1'");
      }),
      now: () => NOW,
      newTaskId: () => `tsk_${++taskSeq}`,
      newEventId: () => `tev_${++eventSeq}`,
    });
    const created = await service.create(createInput());

    await expectCode(
      () => service.update({ taskId: created.id, assignee: "agt_a", status: "running" }),
      "CONFLICT",
    );
    expect((await findTaskById(raw, created.id))?.status).toBe("blocked");
    await raw.close();
  });

  it("未收尾的任务在 update 时补绑新出现的 run", async () => {
    const { db, service } = await prepare();
    const created = await service.create(createInput());
    expect(await findRunById(db, "run_late")).toBeUndefined();

    await addRun(db, "run_late", NOW - 10);
    await service.update({ taskId: created.id, assignee: "agt_a", status: "running" });

    expect((await findRunById(db, "run_late"))?.taskId).toBe(created.id);
    await db.close();
  });

  it("deadline 更新只改字段时保留状态与阶段", async () => {
    const { service, db } = await prepare();
    const created = await service.create(createInput());
    const updated = await service.update({
      taskId: created.id,
      assignee: "agt_a",
      deadlineAt: 42_000,
      output: "https://example.com/spec",
    });

    expect(updated.task).toMatchObject({
      stage: "intake",
      status: "pending",
      deadlineAt: 42_000,
      output: "https://example.com/spec",
    });
    await db.close();
  });
});

describe("completionNotice", () => {
  async function seed(db: Db): Promise<void> {
    await db.run(
      "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'h', 'active', 0)",
    );
    const agents: [string, string, string, string | null][] = [
      ["agt_a", "pa", "Agent A", "ou_a"],
      ["agt_b", "pb", "Agent B", null],
    ];
    for (const [id, project, name, openId] of agents) {
      await db.run(
        `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status,
           allowed_targets_json, feishu_bot_open_id, created_at, updated_at)
         VALUES (?, 'm1', ?, ?, 'h', 'active', '[]', ?, 0, 0)`,
        id, project, name, openId,
      );
    }
    const tasks: [string, string, string, string | null][] = [
      ["tsk_parent", "上游任务", "agt_a", null],
      ["tsk_child", "下游任务", "agt_b", "tsk_parent"],
      ["tsk_same", "同 Agent 续接", "agt_a", "tsk_parent"],
      ["tsk_orphan", "无父任务", "agt_b", null],
    ];
    for (const [id, title, assignee, parent] of tasks) {
      await db.run(
        `INSERT INTO task (id, title, assigner, assignee, project, parent_task_id,
           stage, status, origin, created_at, updated_at)
         VALUES (?, ?, 'console', ?, 'aw', ?, 'exec', 'running', 'a2a', 0, 0)`,
        id, title, assignee, parent,
      );
    }
  }

  it("下游 done 时返回上游发起方(播报由控制台直发,不再带 bot open_id)", async () => {
    const { service, db } = await prepare();
    await seed(db);
    await service.update({ taskId: "tsk_child", assignee: "agt_b", status: "done" });

    expect(await service.completionNotice("tsk_child")).toEqual({
      taskId: "tsk_child",
      title: "下游任务",
      from: { id: "agt_b", displayName: "Agent B" },
      to: { id: "agt_a", displayName: "Agent A" },
      conclusion: null,
    });
    await db.close();
  });

  it("结论取本任务最近一条回执正文", async () => {
    const { service, db } = await prepare();
    await seed(db);
    await db.run(
      `INSERT INTO a2a_thread (id, initiator_task_id, initiator_agent, responder_agent, created_at)
         VALUES ('thr_1', 'tsk_parent', 'agt_a', 'agt_b', 0)`,
    );
    await db.run(
      `INSERT INTO a2a_message (id, thread_id, task_id, round, from_agent, to_agent, intent,
         summary, expect, refs_json, created_at)
         VALUES ('msg_1', 'thr_1', 'tsk_child', 1, 'agt_b', 'agt_a', 'reply',
           '接口契约已落到 docs/api.md', '', '[]', 0)`,
    );
    await service.update({ taskId: "tsk_child", assignee: "agt_b", status: "done" });

    expect(await service.completionNotice("tsk_child")).toMatchObject({
      conclusion: "接口契约已落到 docs/api.md",
    });
    await db.close();
  });

  it("回执正文为空串时不算结论,播报退回占位", async () => {
    const { service, db } = await prepare();
    await seed(db);
    await db.run(
      `INSERT INTO a2a_thread (id, initiator_task_id, initiator_agent, responder_agent, created_at)
         VALUES ('thr_1', 'tsk_parent', 'agt_a', 'agt_b', 0)`,
    );
    await db.run(
      `INSERT INTO a2a_message (id, thread_id, task_id, round, from_agent, to_agent, intent,
         summary, expect, refs_json, created_at)
         VALUES ('msg_1', 'thr_1', 'tsk_child', 1, 'agt_b', 'agt_a', 'reply',
           '   ', '', '[]', 0)`,
    );
    await service.update({ taskId: "tsk_child", assignee: "agt_b", status: "done" });

    expect(await service.completionNotice("tsk_child")).toMatchObject({
      conclusion: null,
    });
    await db.close();
  });

  it("未完成、无父任务或同一 Agent 续接都返回 null", async () => {
    const { service, db } = await prepare();
    await seed(db);

    expect(await service.completionNotice("tsk_child")).toBeNull();
    await service.update({ taskId: "tsk_same", assignee: "agt_a", status: "done" });
    expect(await service.completionNotice("tsk_same")).toBeNull();
    await db.run("UPDATE task SET status = 'done' WHERE id = 'tsk_orphan'");
    expect(await service.completionNotice("tsk_orphan")).toBeNull();
    await db.close();
  });
});

describe("task create 关联工作事项", () => {
  async function seedWork(db: Db): Promise<void> {
    await db.run(
      "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'h', 'active', 0) ON CONFLICT DO NOTHING",
    );
    await db.run(
      `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
       VALUES ('agt_a', 'm1', 'aw', 'agt_a', 'h', 'active', '[]', 0, 0) ON CONFLICT DO NOTHING`,
    );
    await insertWorkItem(db, {
      id: "wim_1",
      project: "aw",
      kind: "bug_fix",
      title: "登录页 500",
      expectedResult: "修好",
      scopeJson: "{}",
      originTriggerId: null,
      authorizationKind: "none",
      authorizationRef: null,
      policyVersion: "test",
      createdAt: 1_000,
    });
    await insertWorkerInboxIfNew(db, {
      id: "wib_1",
      kind: "assignment",
      workItemId: "wim_1",
      triggerId: null,
      targetAgentId: "agt_a",
      idempotencyKey: "assign:wtg_1",
      payloadJson: "{}",
      createdAt: 1_000,
    });
    await db.run("UPDATE worker_inbox SET status = 'claimed' WHERE id = 'wib_1'");
  }

  it("持有有效 assignment 时建单:origin 推导为 work_item 并关联事项", async () => {
    const { db, service } = await prepare();
    await seedWork(db);

    const task = await service.create(createInput({ workItemId: "wim_1" }));
    expect(task.origin).toBe("work_item");
    expect(task.workItemId).toBe("wim_1");
    await db.close();
  });

  it("事项不存在、项目不一致、未持 assignment 分别拒绝", async () => {
    const { db, service } = await prepare();
    await seedWork(db);

    await expectCode(() => service.create(createInput({ workItemId: "wim_missing" })), "NOT_FOUND");
    // wim_1 项目为 aw,任务报 demo 项目
    await expectCode(
      () => service.create(createInput({ project: "demo", workItemId: "wim_1" })),
      "VALIDATION_FAILED",
    );
    await db.run("UPDATE worker_inbox SET status = 'handed_back' WHERE id = 'wib_1'");
    await expectCode(() => service.create(createInput({ workItemId: "wim_1" })), "FORBIDDEN");
    await db.close();
  });
});
