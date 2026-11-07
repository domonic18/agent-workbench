import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAgentTimeline, type AgentRosterSummary } from "../../api/identity.js";
import { AgentTimeline } from "./AgentTimeline.js";

vi.mock("../../api/identity.js", () => ({
  fetchAgentTimeline: vi.fn(),
}));

function agent(overrides: Partial<AgentRosterSummary> = {}): AgentRosterSummary {
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
    totalRuns: 1,
    totalTokens: 10,
    openTasks: 0,
    lastRunAt: null,
    ...overrides,
  };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    runId: "run_1",
    runProject: "aw",
    runMachine: "build-box",
    kind: "user_message",
    occurredAt: 1_700_000_000_000,
    payload: { text: "补一条均线", length: 5 },
    ...overrides,
  };
}

function renderTimeline(target: AgentRosterSummary = agent()): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AgentTimeline agent={target} />
    </QueryClientProvider>,
  );
}

describe("Agent 对话记录", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("外部运行时没有采集器时显示未接入且不发请求", async () => {
    renderTimeline(agent({ runtime: "workbuddy", machineId: null }));

    expect(await screen.findByText("未接入过程数据")).toBeTruthy();
    expect(fetchAgentTimeline).not.toHaveBeenCalled();
  });

  it("按会话分组渲染事件并显示正文", async () => {
    vi.mocked(fetchAgentTimeline).mockResolvedValue({
      items: [
        entry(),
        entry({
          id: "evt_2",
          kind: "assistant_message",
          payload: { text: "已经补上", model: "claude-sonnet-4-6" },
          occurredAt: 1_700_000_001_000,
        }),
      ],
      nextCursor: null,
    });
    renderTimeline();

    expect(await screen.findByText("补一条均线")).toBeTruthy();
    expect(screen.getByText("已经补上")).toBeTruthy();
    expect(screen.getAllByText("aw · build-box").length).toBe(1);
  });

  it("按事件类型过滤", async () => {
    vi.mocked(fetchAgentTimeline).mockResolvedValue({
      items: [
        entry(),
        entry({
          id: "evt_2",
          kind: "tool_call",
          payload: { name: "Read", input: "{}" },
        }),
      ],
      nextCursor: null,
    });
    renderTimeline();

    await screen.findByText("补一条均线");
    fireEvent.click(screen.getByRole("button", { name: "工具调用" }));

    expect(screen.queryByText("补一条均线")).toBeNull();
    expect(screen.getByText("Read")).toBeTruthy();
  });

  it("还有更早记录时按游标继续翻页", async () => {
    vi.mocked(fetchAgentTimeline)
      .mockResolvedValueOnce({
        items: [entry()],
        nextCursor: "1700000000000:evt_1",
      })
      .mockResolvedValueOnce({
        items: [entry({ id: "evt_0", payload: { text: "更早的一句", length: 4 } })],
        nextCursor: null,
      });
    renderTimeline();

    await screen.findByText("补一条均线");
    fireEvent.click(screen.getByRole("button", { name: "加载更早的记录" }));

    expect(await screen.findByText("更早的一句")).toBeTruthy();
    expect(fetchAgentTimeline).toHaveBeenLastCalledWith("agt_a", {
      limit: 50,
      cursor: "1700000000000:evt_1",
    });
  });
});
