import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemDetail, WorkItemDetailResponse } from "../../api/work-items.js";
import { WorkItemDrawer } from "./WorkItemDrawer.js";

class FakeEventSource {
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  addEventListener(): void {}
  close(): void {}
}

function detail(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    id: "wim_1",
    project: "aw",
    kind: "bug_fix",
    title: "修复登录跳转",
    status: "open",
    stage: "execute",
    attention: "person",
    nextAction: "等待人工确认补丁",
    latestSummary: "补丁已提交",
    lastProgressAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    parentWorkItemId: null,
    expectedResult: "登录后回到原页面",
    scope: { repo: "aw/web" },
    originTriggerId: "trg_1",
    authorization: { kind: "auto", ref: null },
    policyVersion: "v3",
    progressRevision: 2,
    output: null,
    validation: null,
    acceptanceRef: null,
    endedAt: null,
    ...overrides,
  };
}

function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function stubApi(payload: WorkItemDetailResponse): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.startsWith("/api/agents")) {
      return fakeResponse({
        items: [
          {
            id: "agt_a",
            displayName: "构建 Agent",
            feishuBotName: "小工",
            machineId: null,
            runtime: "claude_code",
            project: "aw",
            machineHostname: null,
            machineDisplayName: null,
            totalRuns: 0,
            totalTokens: 0,
            openTasks: 0,
            lastRunAt: null,
          },
        ],
        nextCursor: null,
      });
    }
    if (path.startsWith("/api/work-items/wim_1/events")) {
      return fakeResponse({ items: [], nextCursor: null });
    }
    if (path === "/api/work-items/wim_1") {
      return fakeResponse(payload);
    }
    throw new Error(`unexpected ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function renderDrawer(payload: WorkItemDetailResponse, onOpenTask = vi.fn()): void {
  stubApi(payload);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/work-items/wim_1"]}>
        <WorkItemDrawer workItemId="wim_1" onClose={vi.fn()} onOpenTask={onOpenTask} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("工作事项详情抽屉", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("五个区块齐全并给出目标与边界", async () => {
    renderDrawer({ workItem: detail(), tasks: [], runs: [], inbox: [], threads: [] });

    expect(await screen.findByText("目标与边界")).toBeTruthy();
    expect(screen.getByText("当前状态")).toBeTruthy();
    expect(screen.getByText("关联工作")).toBeTruthy();
    expect(screen.getByText("结果与验证")).toBeTruthy();
    expect(await screen.findByText("永久时间线")).toBeTruthy();

    expect(screen.getByText("登录后回到原页面")).toBeTruthy();
    expect(screen.getByText("第 2 次")).toBeTruthy();
    expect(screen.getByText("aw/web")).toBeTruthy();
  });

  it("关联为空时明说不补假节点", async () => {
    renderDrawer({ workItem: detail(), tasks: [], runs: [], inbox: [], threads: [] });

    expect(await screen.findByText("暂无关联任务")).toBeTruthy();
    expect(screen.getByText("暂无执行记录")).toBeTruthy();
    expect(screen.getByText("暂无派工与续接输入")).toBeTruthy();
    expect(screen.getByText("暂无关联线程")).toBeTruthy();
    expect(screen.getByText("尚无产出")).toBeTruthy();
    expect(screen.getByText("尚未验收")).toBeTruthy();
  });

  it("等待对象显示机器人名而不是裸 id", async () => {
    renderDrawer({
      workItem: detail({ attention: "person" }),
      tasks: [],
      runs: [],
      inbox: [
        {
          id: "inb_1",
          kind: "assignment",
          targetAgentId: "agt_a",
          status: "pending",
          taskId: null,
          leaseUntil: null,
          reason: null,
          updatedAt: 1_700_000_000_000,
          createdAt: 1_700_000_000_000,
        },
      ],
      threads: [],
    });

    expect((await screen.findAllByText(/@小工/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/agt_a/)).toBeNull();
  });

  it("挂起行展示原因文案与挂起时长,不裸奔枚举值", async () => {
    renderDrawer({
      workItem: detail(),
      tasks: [],
      runs: [],
      inbox: [
        {
          id: "inb_1",
          kind: "assignment",
          targetAgentId: "agt_a",
          status: "pending",
          taskId: null,
          leaseUntil: null,
          reason: "cwd_session_active",
          updatedAt: Date.now() - 10 * 60_000,
          createdAt: 1_700_000_000_000,
        },
      ],
      threads: [],
    });

    expect(await screen.findByText(/挂起:工作区会话占用中/)).toBeTruthy();
    expect(screen.getByText(/已挂起 10 分钟/)).toBeTruthy();
    expect(screen.queryByText(/cwd_session_active/)).toBeNull();
  });

  it("点关联任务交给外部跳转", async () => {
    const onOpenTask = vi.fn();
    renderDrawer(
      {
        workItem: detail(),
        tasks: [
          {
            id: "tsk_1",
            title: "实现接口契约",
            assignee: "agt_a",
            status: "running",
            origin: "a2a",
            output: null,
            createdAt: 1_700_000_000_000,
          },
        ],
        runs: [],
        inbox: [],
        threads: [],
      },
      onOpenTask,
    );

    fireEvent.click(await screen.findByRole("button", { name: "实现接口契约" }));
    expect(onOpenTask).toHaveBeenCalledWith("tsk_1");
  });
});
