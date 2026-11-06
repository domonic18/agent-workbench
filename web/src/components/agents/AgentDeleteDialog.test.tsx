import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteAgent,
  fetchAgentDeleteImpact,
  fetchAgents,
  type AgentRosterSummary,
} from "../../api/identity.js";
import { AgentDeleteDialog } from "./AgentDeleteDialog.js";
import { ToastProvider } from "../ui/Toast.js";

vi.mock("../../api/identity.js", () => ({
  deleteAgent: vi.fn(),
  fetchAgentDeleteImpact: vi.fn(),
  fetchAgents: vi.fn(),
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
    totalRuns: 0,
    totalTokens: 0,
    openTasks: 0,
    lastRunAt: null,
    ...overrides,
  };
}

const IMPACT = {
  preview: {
    agent: {
      id: "agt_a",
      displayName: "构建 Agent",
      project: "aw",
      machineId: "m1",
      status: "active" as const,
    },
    impact: {
      destroyed: {
        workerInbox: 2,
        a2aThread: 1,
        a2aMessage: 5,
        a2aDeadLetter: 0,
        outboxPull: 1,
        agentRun: 3,
        timelineEvent: 4,
        tokenUsage: 6,
        usageLimit: 0,
      },
      detached: { workTrigger: 1, knowledgeEntry: 2 },
      retained: { task: 7, toolCallLog: 8, workItem: 0 },
    },
    bootstrapPrimary: false,
    bootstrapPrimaryAgentId: null,
  },
};

function renderDialog(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AgentDeleteDialog agentId="agt_a" onClose={vi.fn()} onDeleted={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe("删除 Agent 确认", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("先给影响清单再允许删除", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([agent()]);
    vi.mocked(fetchAgentDeleteImpact).mockResolvedValue(IMPACT);
    renderDialog();

    expect(await screen.findByText("收件箱派工行")).toBeTruthy();
    expect(screen.getByText("工具调用日志")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "确认删除" });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it("写明删除不可逆,A2A 按整条线程口径计数", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([agent()]);
    vi.mocked(fetchAgentDeleteImpact).mockResolvedValue(IMPACT);
    renderDialog();

    expect(await screen.findByText(/删除不可逆/)).toBeTruthy();
    expect(screen.getByText("A2A 线程（整条）")).toBeTruthy();
    expect(screen.getByText("A2A 消息（整条线程内）")).toBeTruthy();
  });

  it("是默认 bug_fix 主责时必须先指定接替者", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([agent()]);
    vi.mocked(fetchAgentDeleteImpact).mockResolvedValue({
      preview: { ...IMPACT.preview, bootstrapPrimary: true, bootstrapPrimaryAgentId: "agt_a" },
    });
    renderDialog();

    expect(await screen.findByText("将被删除")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "确认删除" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it("指定接替者后删除带上改指参数", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent(),
      agent({ id: "agt_b", displayName: "接替 Agent" }),
    ]);
    vi.mocked(fetchAgentDeleteImpact).mockResolvedValue({
      preview: { ...IMPACT.preview, bootstrapPrimary: true, bootstrapPrimaryAgentId: "agt_a" },
    });
    vi.mocked(deleteAgent).mockResolvedValue({
      id: "agt_a",
      replayed: false,
      bootstrapPrimaryReassignedTo: "agt_b",
    });
    renderDialog();

    fireEvent.change(await screen.findByLabelText(/指定接替的默认 bug_fix 主责/), {
      target: { value: "agt_b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(deleteAgent).toHaveBeenCalledWith("agt_a", { reassignBootstrapPrimaryTo: "agt_b" });
  });

  it("删除后失效名册与总览缓存,列表才会少一行", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([agent()]);
    vi.mocked(fetchAgentDeleteImpact).mockResolvedValue(IMPACT);
    vi.mocked(deleteAgent).mockResolvedValue({
      id: "agt_a",
      replayed: false,
      bootstrapPrimaryReassignedTo: null,
    });
    const client = renderDialog();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }));

    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["overview"] });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agents"], exact: true });
  });
});
