import { describe, expect, it } from "vitest";
import type { TaskEventKind } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
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
  return db
    .prepare("SELECT kind, payload_json AS payload FROM task_event WHERE task_id = ? ORDER BY seq")
    .all(taskId) as { kind: TaskEventKind; payload: string }[];
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
    expect(db.prepare("SELECT COUNT(*) AS n FROM task").get()).toEqual({ n: 0 });
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
    expect(running).toMatchObject({ stage: "plan", status: "running", startedAt: NOW });

    service.update({ taskId: created.id, assignee: "agt_a", stage: "exec", status: "review" });
    const reworked = service.update({
      taskId: created.id,
      assignee: "agt_a",
      status: "running",
      reason: "评审发现边界遗漏",
    });
    expect(reworked).toMatchObject({ status: "running", reworkCount: 1 });

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
          db.prepare("UPDATE task SET status = 'blocked' WHERE id = 'tsk_1'").run();
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

  it("deadline 更新只改字段时保留状态与阶段", () => {
    const { db, service } = prepare();
    const created = service.create(createInput());
    const updated = service.update({
      taskId: created.id,
      assignee: "agt_a",
      deadlineAt: 42_000,
      output: "https://example.com/spec",
    });

    expect(updated).toMatchObject({
      stage: "intake",
      status: "pending",
      deadlineAt: 42_000,
      output: "https://example.com/spec",
    });
    db.close();
  });
});
