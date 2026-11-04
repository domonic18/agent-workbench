import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { findTaskById, findTaskSummary, insertTask, listTaskSummaries, updateTask } from "./task.js";

async function prepare(): Promise<Db> {
  return openDatabase();
}

const insert = `
  INSERT INTO task
    (id, title, assigner, assignee, project, stage, status, origin, deadline_at, total_tokens, created_at, updated_at)
  VALUES (?, ?, 'agent-a', 'agent-b', 'aw', 'exec', 'running', 'a2a', ?, ?, ?, ?)
`;

describe("task summaries", () => {
  it("按创建时间倒序返回并带上 token 与 deadline", async () => {
    const db = await prepare();
    await db.run(insert, "T-1", "旧任务", null, 0, 1_000, 1_000);
    await db.run(insert, "T-2", "新任务", 9_999, 42, 2_000, 2_000);

    expect(await listTaskSummaries(db, 10)).toEqual([
      {
        id: "T-2",
        title: "新任务",
        assigner: "agent-a",
        assignee: "agent-b",
        project: "aw",
        stage: "exec",
        status: "running",
        deadlineAt: 9_999,
        totalTokens: 42,
      },
      expect.objectContaining({ id: "T-1", deadlineAt: null }),
    ]);
    expect(await listTaskSummaries(db, 1)).toHaveLength(1);
    await db.close();
  });

  it("按 id 查单条,不存在返回 undefined", async () => {
    const db = await prepare();
    await db.run(insert, "T-1", "任务", null, 0, 1_000, 1_000);

    expect(await findTaskSummary(db, "T-1")).toMatchObject({ id: "T-1", title: "任务" });
    expect(await findTaskSummary(db, "T-9")).toBeUndefined();
    await db.close();
  });
});

const NEW_TASK = {
  id: "T-9",
  title: "写域任务",
  assigner: "agent-a",
  assignee: "agent-b",
  project: "aw",
  parentTaskId: null,
  origin: "a2a" as const,
  deadlineAt: 5_000,
  output: null,
  createdAt: 1_000,
};

describe("task 写域", () => {
  it("insertTask 落全列,新任务从 intake/pending 起跑", async () => {
    const db = await prepare();
    await insertTask(db, NEW_TASK);

    expect(await findTaskById(db, "T-9")).toEqual({
      id: "T-9",
      title: "写域任务",
      assigner: "agent-a",
      assignee: "agent-b",
      project: "aw",
      parentTaskId: null,
      round: 1,
      reworkCount: 0,
      stage: "intake",
      status: "pending",
      origin: "a2a",
      deadlineAt: 5_000,
      output: null,
      startedAt: null,
      endedAt: null,
      totalTokens: 0,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(await findTaskById(db, "T-404")).toBeUndefined();
    await db.close();
  });

  it("updateTask 带 stage/status 前提,读取后被抢先即失败", async () => {
    const db = await prepare();
    await insertTask(db, NEW_TASK);
    const patch = {
      id: "T-9",
      fromStage: "intake",
      fromStatus: "pending",
      stage: "plan",
      status: "running",
      reworkCount: 0,
      output: "kb_notes",
      deadlineAt: 5_000,
      startedAt: 2_000,
      endedAt: null,
      updatedAt: 2_000,
    } as const;

    expect(await updateTask(db, patch)).toBe(true);
    expect(await findTaskById(db, "T-9")).toMatchObject({
      stage: "plan",
      status: "running",
      output: "kb_notes",
      startedAt: 2_000,
      updatedAt: 2_000,
    });
    expect(await updateTask(db, patch)).toBe(false);
    await db.close();
  });
});
