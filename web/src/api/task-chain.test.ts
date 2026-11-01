import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./client.js";
import {
  buildTaskChain,
  relationFromEvents,
  type TaskChainLoaders,
} from "./task-chain.js";
import type {
  TaskDetailResponse,
  TaskDto,
  TaskEventDto,
  TaskEventsResponse,
} from "./tasks.js";

function task(id: string, parentTaskId: string | null = null): TaskDto {
  return {
    id,
    title: `任务 ${id}`,
    assigner: "feishu:alice",
    assignee: "agt_a",
    project: "aw",
    parent_task_id: parentTaskId,
    round: 1,
    rework_count: 0,
    stage: "intake",
    status: "pending",
    origin: "feishu",
    deadline_at: null,
    output: null,
    started_at: null,
    ended_at: null,
    total_tokens: 0,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
  };
}

function event(seq: number, kind: TaskEventDto["kind"], payload: Record<string, unknown>): TaskEventDto {
  return { id: `tev_${seq}`, seq, kind, payload, occurred_at: 1_700_000_000_000 + seq };
}

function detail(value: TaskDto): TaskDetailResponse {
  return { task: value, capabilities: [], tokens: { total: 0, entries: 0 }, revision: 1 };
}

function events(items: TaskEventDto[]): TaskEventsResponse {
  return { revision: 1, items, nextCursor: null };
}

describe("handoff 关联解析", () => {
  it("链头没有父任务时不给关联", () => {
    expect(relationFromEvents([], null)).toBeNull();
  });

  it("按 from_task_id 与 upstream_task_id 匹配最近一条 handoff", () => {
    const history = [
      event(1, "handoff", { relation: "a2a", upstream_task_id: "tsk_other" }),
      event(2, "handoff", { relation: "continuation", from_task_id: "tsk_parent" }),
    ];
    expect(relationFromEvents(history, "tsk_parent")).toBe("continuation");
  });

  it("A2A 交接读 relation=a2a", () => {
    const history = [
      event(1, "handoff", { relation: "a2a", upstream_msg_id: "msg_1", upstream_task_id: "tsk_parent" }),
    ];
    expect(relationFromEvents(history, "tsk_parent")).toBe("a2a");
  });

  it("没有匹配的 handoff 或未知关联按 unknown 处理", () => {
    expect(relationFromEvents([event(1, "created", {})], "tsk_parent")).toBe("unknown");
    expect(
      relationFromEvents([event(1, "handoff", { relation: "mystery", from_task_id: "tsk_parent" })], "tsk_parent"),
    ).toBe("unknown");
  });
});

describe("任务来源链", () => {
  const history: TaskEventsResponse = events([
    event(1, "created", { origin: "feishu" }),
    event(2, "handoff", { relation: "continuation", from_task_id: "tsk_root" }),
  ]);

  function loaders(map: Record<string, TaskDto | Error>): TaskChainLoaders {
    return {
      task: vi.fn(async (id: string) => {
        const value = map[id];
        if (value instanceof Error) {
          throw value;
        }
        if (value === undefined) {
          throw new ApiError(404, "NOT_FOUND", "任务不存在");
        }
        return detail(value);
      }),
      events: vi.fn(async () => history),
    };
  }

  it("沿 parent_task_id 上溯并按链头→当前返回", async () => {
    const loadersStub = loaders({
      tsk_root: task("tsk_root"),
      tsk_mid: task("tsk_mid", "tsk_root"),
    });
    const currentEvents = events([
      event(1, "handoff", { relation: "continuation", from_task_id: "tsk_mid" }),
    ]);
    const result = await buildTaskChain(
      task("tsk_cur", "tsk_mid"),
      currentEvents.items,
      loadersStub,
    );

    expect(result.truncated).toBe(false);
    expect(result.entries.map((entry) => entry.taskId)).toEqual(["tsk_root", "tsk_mid", "tsk_cur"]);
    expect(result.entries.map((entry) => entry.relation)).toEqual([null, "continuation", "continuation"]);
    expect(loadersStub.task).toHaveBeenCalledTimes(2);
  });

  it("父任务查不到时保留空节点并停止上溯", async () => {
    const loadersStub = loaders({ tsk_root: task("tsk_root") });
    const result = await buildTaskChain(task("tsk_cur", "tsk_missing"), [], loadersStub);

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ taskId: "tsk_missing", task: null, relation: null });
    expect(result.entries[1]?.taskId).toBe("tsk_cur");
    expect(loadersStub.task).toHaveBeenCalledTimes(1);
  });

  it("检测到环时截断而不重复请求", async () => {
    const loadersStub = loaders({
      tsk_b: task("tsk_b", "tsk_a"),
    });
    const result = await buildTaskChain(task("tsk_a", "tsk_b"), [], loadersStub);

    expect(result.truncated).toBe(true);
    expect(result.entries.map((entry) => entry.taskId)).toEqual(["tsk_b", "tsk_a"]);
  });

  it("超过深度上限时截断", async () => {
    const map: Record<string, TaskDto> = {};
    for (let index = 0; index < 12; index += 1) {
      map[`tsk_${index}`] = task(`tsk_${index}`, index === 0 ? null : `tsk_${index - 1}`);
    }
    const result = await buildTaskChain(task("tsk_11", "tsk_10"), [], loaders(map));

    expect(result.truncated).toBe(true);
    expect(result.entries).toHaveLength(10);
  });

  it("非 404 错误继续抛出", async () => {
    await expect(
      buildTaskChain(task("tsk_cur", "tsk_parent"), [], loaders({ tsk_parent: new Error("boom") })),
    ).rejects.toThrow("boom");
  });
});
