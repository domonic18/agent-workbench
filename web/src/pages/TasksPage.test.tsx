import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeProvider } from "../api/stream.js";
import type { TaskDto } from "../api/tasks.js";
import { TasksPage } from "./TasksPage.js";

class FakeEventSource {
  static lastUrl = "";
  onerror: (() => void) | null = null;

  constructor(url: string) {
    FakeEventSource.lastUrl = url;
  }

  addEventListener(): void {}

  close(): void {}
}

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "tsk_1",
    title: "实现任务屏",
    assigner: "feishu:alice",
    assignee: "agt_a",
    assigner_label: "feishu:alice",
    assignee_label: "agt_a",
    project: "aw",
    parent_task_id: null,
    work_item_id: null,
    round: 1,
    rework_count: 0,
    stage: "exec",
    status: "running",
    origin: "feishu",
    deadline_at: null,
    output: null,
    started_at: 1_700_000_000_000,
    ended_at: null,
    total_tokens: 0,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function stubApi(items: TaskDto[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/tasks" || path.startsWith("/api/tasks?")) {
      return fakeResponse({ items, nextCursor: null });
    }
    if (path === "/api/agents") {
      return fakeResponse({ items: [], nextCursor: null });
    }
    if (path.startsWith("/api/work-items")) {
      return fakeResponse({ items: [], nextCursor: null });
    }
    throw new Error(`unexpected ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage(entry: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        {/* overview 作用域的实时连接由外壳持有，页面测试里显式提供 */}
        <RealtimeProvider>
          <TasksPage />
        </RealtimeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("任务列表页", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("按 URL 筛选请求,并渲染行与可见性页脚", async () => {
    const fetchMock = stubApi([task()]);
    renderPage("/tasks?status=running&project=aw");

    expect((await screen.findAllByText("实现任务屏")).length).toBeGreaterThan(0);
    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.includes("status=running") && url.includes("project=aw"))).toBe(
      true,
    );
    expect(
      screen.getByText("仅显示已自报的任务——Agent 判断不需要建单的活不会出现在这里。"),
    ).toBeTruthy();
    expect(FakeEventSource.lastUrl).toContain("scope=overview");
  });

  it("有筛选但无结果时提示调整条件", async () => {
    stubApi([]);
    renderPage("/tasks?project=aw");

    expect(await screen.findByText("没有匹配的任务")).toBeTruthy();
    expect(screen.getByText("调整筛选条件后再试。")).toBeTruthy();
  });

  it("无筛选且无记录时说明 Agent 尚未上报", async () => {
    stubApi([]);
    renderPage("/tasks");

    expect(await screen.findByText("暂无任务记录")).toBeTruthy();
    expect(
      screen.getByText("Agent 尚未上报任务；未建单的工作不会出现在这里。"),
    ).toBeTruthy();
  });

  it("任务屏同时给出工作事项区块", async () => {
    stubApi([]);
    renderPage("/tasks");

    expect(await screen.findByRole("region", { name: "工作事项" })).toBeTruthy();
    expect(
      screen.getByText("仅展示已由触发事实路由出的工作事项——没被路由的活不会出现在这里。"),
    ).toBeTruthy();
  });
});
