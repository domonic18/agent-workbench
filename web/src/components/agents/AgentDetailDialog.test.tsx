import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAgents, fetchAgentTimeline, type AgentRosterSummary } from "../../api/identity.js";
import { fetchTasks } from "../../api/tasks.js";
import { AgentDetailDialog } from "./AgentDetailDialog.js";

vi.mock("../../api/identity.js", () => ({
  fetchAgents: vi.fn(),
  fetchAgentTimeline: vi.fn(),
}));

vi.mock("../../api/tasks.js", () => ({
  fetchTasks: vi.fn(),
}));

function agent(): AgentRosterSummary {
  return {
    id: "agt_a",
    machineId: "m1",
    runtime: "claude_code",
    project: "aw",
    displayName: "构建 Agent",
    feishuAppId: null,
    feishuBotName: "小工",
    status: "active",
    allowedTargets: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    key: null,
    usageLimit: null,
    machineHostname: "build-box",
    machineDisplayName: "工作室机",
    totalRuns: 3,
    totalTokens: 1200,
    openTasks: 1,
    lastRunAt: null,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderDialog(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={["/overview"]}>
      <QueryClientProvider client={client}>
        <AgentDetailDialog agentId="agt_a" live={undefined} onClose={() => {}} />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Agent 详情抽屉", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("概览区展示身份档案与用量", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([agent()]);
    renderDialog();

    expect(await screen.findByText("工作室机")).toBeTruthy();
    expect((await screen.findAllByText("小工")).length).toBeGreaterThan(0);
    expect(screen.getByText("aw")).toBeTruthy();
    expect(screen.getByText("3 次")).toBeTruthy();
  });

  it("任务区列出该 Agent 的任务并可跳到任务详情", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([agent()]);
    vi.mocked(fetchTasks).mockResolvedValue({
      items: [
        {
          id: "tsk_1",
          title: "实现接口契约",
          assigner: "agt_b",
          assignee: "agt_a",
          assigner_label: "agt_b",
          assignee_label: "agt_a",
          project: "aw",
          parent_task_id: null,
          round: 1,
          rework_count: 0,
          stage: "exec",
          status: "running",
          origin: "feishu",
          deadline_at: null,
          output: null,
          started_at: null,
          ended_at: null,
          total_tokens: 0,
          created_at: 0,
          updated_at: 1_700_000_000_000,
        },
      ],
      nextCursor: null,
    });
    renderDialog();

    fireEvent.click(await screen.findByRole("tab", { name: "任务" }));

    expect(await screen.findByText("实现接口契约")).toBeTruthy();
    fireEvent.click(screen.getByText("实现接口契约"));

    expect(screen.getByTestId("pathname").textContent).toBe("/tasks/tsk_1");
  });

  it("对话记录区展示过程事件", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([agent()]);
    vi.mocked(fetchAgentTimeline).mockResolvedValue({
      items: [
        {
          id: "evt_1",
          runId: "run_1",
          runProject: "aw",
          runMachine: "build-box",
          kind: "user_message",
          occurredAt: 1_700_000_000_000,
          payload: { text: "补一条均线", length: 5 },
        },
      ],
      nextCursor: null,
    });
    renderDialog();

    fireEvent.click(await screen.findByRole("tab", { name: "对话记录" }));

    expect(await screen.findByText("补一条均线")).toBeTruthy();
  });
});
