import { describe, expect, it } from "vitest";
import { RUN_IDLE_GAP_MS, type TaskEventKind } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import {
  bindRunTaskIfEmpty,
  findRunById,
  insertRun,
} from "../../store/repositories/run.js";
import { findTaskById } from "../../store/repositories/task.js";
import { TaskError } from "./errors.js";
import { createTaskService, type TaskCreateInput, type TaskService } from "./service.js";

const NOW = 1_000;

function prepare(options: { now?: () => number } = {}): {
  db: Db;
  service: TaskService;
} {
  const db = openDatabase(":memory:");
  runMigrations(db);
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

function addRun(db: Db, id: string, lastSeenAt: number): void {
  await db.run(
    "INSERT OR IGNORE INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'h', 'active', 0)",
  );
  await db.run(
    `INSERT OR IGNORE INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
     VALUES ('agt_a', 'm1', 'aw', 'agt_a', 'h', 'active', '[]', 0, 0)`,
  );
  insertRun(db, {
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

function events(db: Db, taskId: string): { kind: TaskEventKind; payload: unknown }[] {
  return await db.all("SELECT kind, payload_json AS payload FROM task_event WHERE task_id = ? ORDER BY seq", taskId) as { kind: TaskEventKind; payload: string }[];
}

function expectCode(fn: () => unknown, code: TaskError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TaskError);
    expect((error as TaskError).code).toBe(code);
    return;
  }
  throw new Error("预期抛出 TaskError,实际未抛出");
}

describe("createTaskService.create", () => {
  it("从 intake/pending 起跑并写 created 事件", () => {
    const { db, service } = prepare();
    const task = service.create(createInput({ output: "kb_notes", deadlineAt: 9_000 }));

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
    expect(events(db, task.id)).toEqual([
      { kind: "created", payload: JSON.stringify({ origin: "a2a", assigner: "console", project: "aw" }) },
    ]);
    db.close();
  });

  it("续接父任务写 handoff(relation=continuation)", () => {
    const { db, service } = prepare();
    const parent = service.create(createInput());
    const child = service.create(createInput({ title: "续接", parentTaskId: parent.id }));

    expect(child.parentTaskId).toBe(parent.id);
    expect(events(db, child.id)).toEqual([
      expect.objectContaining({ kind: "created" }),
      {
        kind: "handoff",
        payload: JSON.stringify({ relation: "continuation", from_task_id: parent.id }),
      },
    ]);
    db.close();
  });

  it("父任务不存在 404,非本人 403", () => {
    const { db, service } = prepare();
    expectCode(() => service.create(createInput({ parentTaskId: "tsk_404" })), "NOT_FOUND");

    const other = service.create(createInput({ assignee: "agt_b" }));
    expectCode(() => service.create(createInput({ parentTaskId: other.id })), "FORBIDDEN");
    db.close();
  });

  it("output 非法 422 且不落库", () => {
    const { db, service } = prepare();
    expectCode(() => service.create(createInput({ output: "自由文本" })), "VALIDATION_FAILED");
    expect(await db.get("SELECT COUNT(*) AS n FROM task")).toEqual({ n: 0 });
    db.close();
  });

  it("建单绑定调用方最近活跃的未归属 run", () => {
    const { db, service } = prepare();
    addRun(db, "run_old", NOW - 100);
    addRun(db, "run_new", NOW - 50);

    const task = service.create(createInput());

    expect(findRunById(db, "run_new")?.taskId).toBe(task.id);
    expect(findRunById(db, "run_old")?.taskId).toBeNull();
    db.close();
  });

  it("已归属任务的 run 不被抢占,空闲超窗的 run 不参与绑定", () => {
    const at = NOW + RUN_IDLE_GAP_MS + 1;
    const { db, service } = prepare({ now: () => at });
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
    addRun(db, "run_bound", at - 50);
    expect(bindRunTaskIfEmpty(db, "run_bound", "tsk_other")).toBe(true);
    addRun(db, "run_stale", NOW);

    const task = service.create(createInput());

    expect(findRunById(db, "run_bound")?.taskId).toBe("tsk_other");
    expect(findRunById(db, "run_stale")?.taskId).toBeNull();
    expect(task.id).not.toBe("tsk_other");
    db.close();
  });
});

describe("createTaskService.update", () => {
  it("按状态机推进并写事件,review→running 记返工", () => {
    const { db, service } = prepare();
    const created = service.create(createInput());

    const running = service.update({
      taskId: created.id,
      assignee: "agt_a",
      stage: "plan",
      status: "running",
    });
    expect(running.task).toMatchObject({ stage: "plan", status: "running", startedAt: NOW });
    expect(running.autoClosed).toEqual([]);

    service.update({ taskId: created.id, assignee: "agt_a", stage: "exec", status: "review" });
    const reworked = service.update({
      taskId: created.id,
      assignee: "agt_a",
      status: "running",
      reason: "评审发现边界遗漏",
    });
    expect(reworked.task).toMatchObject({ status: "running", reworkCount: 1 });

    expect(events(db, created.id).map((event) => event.kind)).toEqual([
      "created",
      "stage_changed",
      "resumed",
      "stage_changed",
      "rework",
    ]);
    expect(events(db, created.id).at(-1)?.payload).toContain("评审发现边界遗漏");
    db.close();
  });

  it("阻塞事件携带原因", () => {
    const { db, service } = prepare();
    const created = service.create(createInput());
    service.update({ taskId: created.id, assignee: "agt_a", status: "running" });
    service.update({
      taskId: created.id,
      assignee: "agt_a",
      status: "blocked",
      reason: "等待审批补签",
    });

    expect(events(db, created.id).at(-1)?.payload).toContain("等待审批补签");
    db.close();
  });

  it("非法状态跃迁 422,非本人 403,不存在 404", () => {
    const { db, service } = prepare();
    const created = service.create(createInput());

    expectCode(
      () => service.update({ taskId: created.id, assignee: "agt_a", status: "done" }),
      "VALIDATION_FAILED",
    );
    expectCode(
      () => service.update({ taskId: created.id, assignee: "agt_b", status: "running" }),
      "FORBIDDEN",
    );
    expectCode(
      () => service.update({ taskId: "tsk_404", assignee: "agt_a", status: "running" }),
      "NOT_FOUND",
    );
    db.close();
  });

  it("读后被抢先修改即 CONFLICT", () => {
    let interfere = false;
    const db = openDatabase(":memory:");
    runMigrations(db);
    let taskSeq = 0;
    let eventSeq = 0;
    const service = createTaskService({
      db,
      now: () => {
        if (interfere) {
          interfere = false;
          await db.run("UPDATE task SET status = 'blocked' WHERE id = 'tsk_1'");
        }
        return NOW;
      },
      newTaskId: () => `tsk_${++taskSeq}`,
      newEventId: () => `tev_${++eventSeq}`,
    });
    const created = service.create(createInput());
    interfere = true;

    expectCode(
      () => service.update({ taskId: created.id, assignee: "agt_a", status: "running" }),
      "CONFLICT",
    );
    expect(findTaskById(db, created.id)?.status).toBe("blocked");
    db.close();
  });

  it("未收尾的任务在 update 时补绑新出现的 run", () => {
    const { db, service } = prepare();
    const created = service.create(createInput());
    expect(findRunById(db, "run_late")).toBeUndefined();

    addRun(db, "run_late", NOW - 10);
    service.update({ taskId: created.id, assignee: "agt_a", status: "running" });

    expect(findRunById(db, "run_late")?.taskId).toBe(created.id);
    db.close();
  });

  it("deadline 更新只改字段时保留状态与阶段", () => {
    const { db, service } = prepare();
    const created = service.create(createInput());
    const updated = service.update({
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
    db.close();
  });
});

describe("completionNotice", () => {
  function seed(db: Db): void {
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
         VALUES (?, 'm1', ?, ?, 'h', 'active', '[]', ?, 0, 0)`,  id, project, name, openId);
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
         VALUES (?, ?, 'console', ?, 'aw', ?, 'exec', 'running', 'a2a', 0, 0)`,  id, title, assignee, parent);
    }
  }

  it("下游 done 时返回上游发起方(播报由控制台直发,不再带 bot open_id)", () => {
    const { db, service } = prepare();
    seed(db);
    service.update({ taskId: "tsk_child", assignee: "agt_b", status: "done" });

    expect(service.completionNotice("tsk_child")).toEqual({
      taskId: "tsk_child",
      title: "下游任务",
      from: { id: "agt_b", displayName: "Agent B" },
      to: { id: "agt_a", displayName: "Agent A" },
    });
    db.close();
  });

  it("未完成、无父任务或同一 Agent 续接都返回 null", () => {
    const { db, service } = prepare();
    seed(db);

    expect(service.completionNotice("tsk_child")).toBeNull();
    service.update({ taskId: "tsk_same", assignee: "agt_a", status: "done" });
    expect(service.completionNotice("tsk_same")).toBeNull();
    await db.run("UPDATE task SET status = 'done' WHERE id = 'tsk_orphan'");
    expect(service.completionNotice("tsk_orphan")).toBeNull();
    db.close();
  });
});
