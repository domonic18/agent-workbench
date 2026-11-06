import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TaskDetailResponse,
  TaskDto,
  TaskEventDto,
  TaskEventsResponse,
} from "../../api/tasks.js";
import { TaskDrawer } from "./TaskDrawer.js";

class FakeEventSource {
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  addEventListener(): void {}
  close(): void {}
}

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "tsk_cur",
    title: "实现任务屏",
    assigner: "feishu:alice",
    assignee: "agt_a",
    assigner_label: "feishu:alice",
    assignee_label: "agt_a",
    project: "aw",
    parent_task_id: null,
    round: 1,
    rework_count: 1,
    stage: "exec",
    status: "blocked",
    origin: "feishu",
    deadline_at: null,
    output: null,
    started_at: 1_700_000_000_000,
    ended_at: null,
    total_tokens: 42,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_050_000,
    ...overrides,
  };
}

function event(seq: number, kind: TaskEventDto["kind"], payload: Record<string, unknown>): TaskEventDto {
  return { id: `tev_${seq}`, seq, kind, payload, occurred_at: 1_700_000_000_000 + seq * 1_000 };
}

function detail(value: TaskDto): TaskDetailResponse {
  return { task: value, capabilities: [], tokens: { total: 0, entries: 0 }, revision: 1 };
}

function events(items: TaskEventDto[]): TaskEventsResponse {
  return { revision: 1, items, nextCursor: null };
}

const CURRENT_EVENTS: TaskEventDto[] = [
  event(1, "created", { origin: "feishu", assigner: "feishu:alice", project: "aw" }),
  event(2, "handoff", { relation: "a2a", upstream_msg_id: "msg_1", upstream_task_id: "tsk_parent" }),
  event(3, "stage_changed", { from: "intake", to: "exec" }),
  event(4, "blocked", { from: "running", to: "blocked", reason: "等待审批" }),
];

function fakeResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

interface StubOptions {
  current?: TaskDto;
  currentEvents?: TaskEventDto[];
  parent?: TaskDto | null;
  a2a?: unknown;
}

function stubApi(options: StubOptions = {}): void {
  const current = options.current ?? task();
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/agents") {
      return fakeResponse({ items: [], nextCursor: null });
    }
    if (path.startsWith("/api/tasks/tsk_cur/events")) {
      return fakeResponse(events(options.currentEvents ?? CURRENT_EVENTS));
    }
    if (path === "/api/tasks/tsk_cur/a2a") {
      return fakeResponse(
        options.a2a ?? {
          revision: 1,
          threads: [
            {
              thread_id: "thr_1",
              initiator_task_id: "tsk_cur",
              initiator_agent: "agt_a",
              responder_agent: "agt_b",
              created_at: 1_700_000_000_000,
              status: "awaiting_reply",
              messages: [
                {
                  msg_id: "msg_1",
                  thread_id: "thr_1",
                  task_id: "tsk_cur",
                  round: 1,
                  reply_to: null,
                  from: "agt_a",
                  to: "agt_b",
                  intent: "request",
                  summary: "请确认接口契约",
                  expect: "released",
                  deadline_at: null,
                  refs: [],
                  auth_ticket: null,
                  ack_at: 1_700_000_010_000,
                  created_at: 1_700_000_000_000,
                  delivery: { status: "delivered", attempts: 1, last_error: null },
                },
              ],
            },
          ],
        },
      );
    }
    if (path === "/api/tasks/tsk_cur") {
      return fakeResponse(detail(current));
    }
    if (path === "/api/tasks/tsk_parent") {
      return options.parent === null
        ? fakeResponse({ error: { code: "NOT_FOUND", message: "任务不存在" } }, 404)
        : fakeResponse(detail(options.parent ?? task({ id: "tsk_parent", title: "上游任务" })));
    }
    if (path.startsWith("/api/tasks/tsk_parent/events")) {
      return fakeResponse(events([]));
    }
    if (path.startsWith("/api/tasks/tsk_gone")) {
      return fakeResponse({ error: { code: "NOT_FOUND", message: "任务不存在" } }, 404);
    }
    throw new Error(`unexpected ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function renderDrawer(options: StubOptions = {}, onClose = vi.fn()): void {
  stubApi(options);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/tasks?project=aw"]}>
        <TaskDrawer taskId={options.current?.id ?? "tsk_cur"} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("任务详情抽屉", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("展示时间线、阻塞原因与 A2A 投递状态", async () => {
    renderDrawer({ current: task({ parent_task_id: "tsk_parent" }) });

    expect(await screen.findByText("阶段 接入 → 执行")).toBeTruthy();
    expect(screen.getByText("来源 飞书 · 下发人 feishu:alice · 项目 aw")).toBeTruthy();
    expect(screen.getByText(/#4 转为阻塞/)).toBeTruthy();
    expect(screen.getByText("等待审批")).toBeTruthy();
    expect(screen.getByText("等待回复")).toBeTruthy();
    expect(screen.getByText("已投递")).toBeTruthy();
    expect(screen.getByText("请确认接口契约")).toBeTruthy();
    expect(await screen.findByText("A2A 交接")).toBeTruthy();
  });

  it("父任务不存在时链头显式说明", async () => {
    renderDrawer({ current: task({ parent_task_id: "tsk_gone" }) });

    expect(await screen.findByText("上游无任务记录（tsk_gone）")).toBeTruthy();
  });

  it("根任务提示链路起点", async () => {
    renderDrawer();

    expect(await screen.findByText("这是链路起点，没有上游任务。")).toBeTruthy();
  });

  it("没有 A2A 往返时给出空态", async () => {
    renderDrawer({ a2a: { revision: 1, threads: [] } });

    expect(await screen.findByText("该任务没有 A2A 往返。")).toBeTruthy();
  });

  it("Esc 关闭抽屉", async () => {
    const onClose = vi.fn();
    renderDrawer({}, onClose);
    await screen.findByText("阶段 接入 → 执行");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
