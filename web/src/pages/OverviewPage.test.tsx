import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRosterSummary } from "../api/identity.js";
import { RealtimeProvider } from "../api/stream.js";
import type { OverviewSnapshot } from "../api/types.js";
import { OverviewPage } from "./OverviewPage.js";

class FakeEventSource {
  static lastUrl = "";
  onerror: (() => void) | null = null;

  constructor(url: string) {
    FakeEventSource.lastUrl = url;
  }

  addEventListener(): void {}

  close(): void {}
}

function snapshot(overrides: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    revision: 3,
    generatedAt: 1_700_000_000_000,
    todayStart: 1_699_996_800_000,
    metrics: {
      runningAgents: 1,
      runningTasks: 2,
      todayTokens: 1_200_000,
      pendingApprovals: 4,
      heartbeatTimeouts: 0,
    },
    agents: [],
    ...overrides,
  };
}

function rosterAgent(overrides: Partial<AgentRosterSummary> = {}): AgentRosterSummary {
  return {
    id: "agt_a",
    machineId: "m1",
    runtime: "claude_code",
    project: "aw",
    displayName: "构建 Agent",
    feishuAppId: null,
    feishuBotName: null,
    status: "active",
    allowedTargets: [],
    createdAt: 0,
    updatedAt: 0,
    key: null,
    usageLimit: null,
    machineHostname: "build-box",
    machineDisplayName: null,
    totalRuns: 3,
    totalTokens: 1200,
    openTasks: 1,
    lastRunAt: 1_699_999_999_000,
    ...overrides,
  };
}

function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** 按路径分派：总览快照、Agent 名册与执行面产物清单形状不同 */
function fakeFetch(
  body: unknown,
  roster: AgentRosterSummary[] = [],
): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/api/bootstrap/artifacts")) {
      return fakeResponse({ publicUrl: null, assets: [] });
    }
    if (path.includes("/api/agents")) {
      return fakeResponse({ items: roster, nextCursor: null });
    }
    return fakeResponse(body);
  });
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={["/overview"]}>
      <QueryClientProvider client={client}>
        {/* overview 作用域的实时连接由外壳持有，页面测试里显式提供 */}
        <RealtimeProvider>
          <OverviewPage />
          <LocationProbe />
        </RealtimeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("总览页", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("名册为空时给引导空态并保留可见性说明", async () => {
    vi.stubGlobal("fetch", fakeFetch(snapshot()));
    renderPage();

    expect(await screen.findByText("名册里还没有 Agent")).toBeTruthy();
    expect(screen.getByText(/控制台只看到自报的与自己的会话/)).toBeTruthy();
    expect(screen.getByText("Agent 在线")).toBeTruthy();
    expect(screen.getByText("今日 Token")).toBeTruthy();
    expect(screen.getByText("1.2M")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "机器登记" })).toBeNull();
    expect(screen.getByRole("button", { name: "接入执行机" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "注册 Agent" })).toBeTruthy();
    // 总览只讲 Agent;任务与工作事项在任务屏
    expect(screen.queryByRole("region", { name: "工作事项" })).toBeNull();
  });

  it("订阅 overview 作用域并把活体状态合并进管理表格", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(
        snapshot({
          agents: [
            {
              id: "agt_a",
              displayName: "构建 Agent",
              feishuBotName: null,
              project: "aw",
              machineId: "m1",
              runtime: "claude_code",
              machineHostname: "build-box",
    machineDisplayName: null,
              machineLastSeenAt: 1_699_999_999_000,
              heartbeat: "ok",
              activeSessions: 5,
              lastRunAt: null,
              running: true,
              currentTaskId: "tsk_1",
              currentTaskTitle: "实现接口契约",
              currentTaskStage: "exec",
              currentTaskStatus: "running",
              currentInstruction: null,
              todayTokens: 42,
            },
          ],
        }),
        [rosterAgent()],
      ),
    );
    renderPage();

    expect((await screen.findAllByText("构建 Agent")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("运行中").length).toBeGreaterThan(0);
    expect(screen.getAllByText("实现接口契约").length).toBeGreaterThan(0);
    expect(screen.getAllByText("启用").length).toBeGreaterThan(0);
    // 活跃会话列:同机共享的本机会话数
    expect(screen.getByText("活跃会话")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(FakeEventSource.lastUrl).toContain("scope=overview");
    expect(FakeEventSource.lastUrl).toContain("client_id=");
  });

  it("提供接入执行机入口并跳到接入向导", async () => {
    vi.stubGlobal("fetch", fakeFetch(snapshot()));
    renderPage();

    const entry = await screen.findByRole("button", { name: "接入执行机" });
    entry.click();
    await waitFor(() => {
      expect(screen.getByTestId("pathname").textContent).toBe("/onboarding");
    });
  });
});
