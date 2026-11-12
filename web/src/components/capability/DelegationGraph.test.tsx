import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAgents, setAgentTargets, type AgentRosterSummary } from "../../api/identity.js";
import { DelegationGraph } from "./DelegationGraph.js";
import { useDelegationDraft } from "./useDelegationDraft.js";

vi.mock("../../api/identity.js", () => ({
  fetchAgents: vi.fn(),
  setAgentTargets: vi.fn(),
}));

function agent(
  id: string,
  displayName: string,
  allowedTargets: string[] = [],
): AgentRosterSummary {
  return {
    id,
    machineId: "m1",
    runtime: "claude_code",
    project: id,
    displayName,
    feishuAppId: null,
    feishuBotName: null,
    status: "active",
    allowedTargets,
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
  };
}

function Harness() {
  const draft = useDelegationDraft();
  return <DelegationGraph draft={draft} />;
}

function renderGraph(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("委派关系图", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("渲染节点命中按钮并带委派计数", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent("agt_a", "Agent A", ["agt_b"]),
      agent("agt_b", "Agent B"),
      agent("agt_c", "Agent C"),
    ]);
    renderGraph();

    expect(
      await screen.findByRole("button", { name: "Agent A（委派 1 方）" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agent B（委派 0 方）" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "委派关系图" })).toBeTruthy();
  });

  it("点击节点打开编辑面板,可移除与新增收件方", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent("agt_a", "Agent A", ["agt_b"]),
      agent("agt_b", "Agent B"),
      agent("agt_c", "Agent C"),
    ]);
    renderGraph();

    fireEvent.click(await screen.findByRole("button", { name: "Agent A（委派 1 方）" }));

    const panel = screen.getByRole("group", { name: "委派编辑面板" });
    expect(within(panel).getByText("Agent A 可委派给")).toBeTruthy();
    expect(within(panel).getByText("Agent B")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "移除 Agent B" }));
    expect(within(panel).getByText("暂无收件方")).toBeTruthy();
    expect(screen.getByText("1 个发起方有未保存的改动。")).toBeTruthy();

    fireEvent.change(within(panel).getByLabelText("添加收件方"), { target: { value: "agt_c" } });
    expect(within(panel).getByText("Agent C")).toBeTruthy();
  });

  it("保存只对变更过的发起方 PUT 一次", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent("agt_a", "Agent A", ["agt_b"]),
      agent("agt_b", "Agent B"),
      agent("agt_c", "Agent C"),
    ]);
    vi.mocked(setAgentTargets).mockResolvedValue({
      agent: agent("agt_a", "Agent A", ["agt_b", "agt_c"]),
    });
    renderGraph();

    fireEvent.click(await screen.findByRole("button", { name: "Agent A（委派 1 方）" }));
    const panel = screen.getByRole("group", { name: "委派编辑面板" });
    fireEvent.change(within(panel).getByLabelText("添加收件方"), { target: { value: "agt_c" } });
    fireEvent.click(within(panel).getByRole("button", { name: "保存委派" }));

    await waitFor(() => expect(setAgentTargets).toHaveBeenCalledTimes(1));
    expect(setAgentTargets).toHaveBeenCalledWith("agt_a", ["agt_b", "agt_c"]);
  });
});
