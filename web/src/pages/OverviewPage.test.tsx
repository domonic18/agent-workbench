import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** 按路径分派响应:总览快照与执行面产物清单形状不同 */
function fakeFetch(body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) =>
    fakeResponse(String(input).includes("/api/bootstrap/artifacts")
      ? { publicUrl: null, assets: [] }
      : body),
  );
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      {/* overview 作用域的实时连接由外壳持有，页面测试里显式提供 */}
      <RealtimeProvider>
        <OverviewPage />
      </RealtimeProvider>
    </QueryClientProvider>,
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

  it("无 Agent 时给排查空态并保留可见性说明", async () => {
    vi.stubGlobal("fetch", fakeFetch(snapshot()));
    renderPage();

    expect(await screen.findByText("采集器未上报")).toBeTruthy();
    expect(screen.getByText(/控制台只看到自报的与自己的会话/)).toBeTruthy();
    expect(screen.getByText("Agent 在线")).toBeTruthy();
    expect(screen.getByText("今日 Token")).toBeTruthy();
    expect(screen.getByText("1.2M")).toBeTruthy();
    expect(screen.getByRole("button", { name: "机器登记" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "注册 Agent" })).toBeTruthy();
  });

  it("订阅 overview 作用域并展示 Agent 行", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(
        snapshot({
          agents: [
            {
              id: "agt_a",
              displayName: "构建 Agent",
              project: "aw",
              machineId: "m1",
              runtime: "claude_code",
              machineHostname: "build-box",
              machineLastSeenAt: 1_699_999_999_000,
              heartbeat: "ok",
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
      ),
    );
    renderPage();

    expect((await screen.findAllByText("aw@build-box")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("运行中").length).toBeGreaterThan(0);
    expect(screen.getAllByText("实现接口契约").length).toBeGreaterThan(0);
    expect(FakeEventSource.lastUrl).toContain("scope=overview");
    expect(FakeEventSource.lastUrl).toContain("client_id=");
  });

  it("执行机接入面板默认展开,下载直链不藏在折叠区里", async () => {
    vi.stubGlobal("fetch", fakeFetch(snapshot()));
    renderPage();

    const disclosure = (await screen.findByText("添加执行机")).closest("details");
    expect(disclosure?.open).toBe(true);
  });
});
