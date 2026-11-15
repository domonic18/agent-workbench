import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAgentGroups } from "../api/agent-groups.js";
import {
  fetchAgents,
  setAgentTargets,
  type AgentRosterSummary,
  type AgentSummary,
} from "../api/identity.js";
import { layoutGraph } from "../components/delegation/layout.js";
import { DelegationPage } from "./DelegationPage.js";

vi.mock("../api/identity.js", () => ({
  fetchAgents: vi.fn(),
  setAgentTargets: vi.fn(),
}));

vi.mock("../api/agent-groups.js", () => ({
  fetchAgentGroups: vi.fn(),
  createAgentGroup: vi.fn(),
  updateAgentGroup: vi.fn(),
  deleteAgentGroup: vi.fn(),
}));

function agent(id: string, displayName: string, allowedTargets: string[] = []): AgentRosterSummary {
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

const AGENTS = [agent("agt_a", "甲"), agent("agt_b", "乙"), agent("agt_c", "丙")];

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={["/delegation"]}>
      <QueryClientProvider client={client}>
        <DelegationPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("委派屏", () => {
  beforeEach(() => {
    vi.mocked(fetchAgents).mockResolvedValue(AGENTS);
    vi.mocked(fetchAgentGroups).mockResolvedValue([]);
    vi.mocked(setAgentTargets).mockResolvedValue({ agent: AGENTS[0] as AgentSummary });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("列出所有 Agent 与说明", async () => {
    renderPage();

    expect(await screen.findByText("委派关系")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /甲/ })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /丙/ })).toBeTruthy();
  });

  it("按名称筛选后只剩匹配的节点", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /甲/ })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("筛选 Agent"), { target: { value: "乙" } });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /甲/ })).toBeNull();
    });
    expect(screen.getByRole("button", { name: /乙/ })).toBeTruthy();
  });

  it("拖线产生的改动进草稿,保存只提交变更过的发起方", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /甲/ })).toBeTruthy();
    });

    const canvas = screen.getByTestId("delegation-canvas");
    const handle = canvas.querySelector('[data-handle="1"][data-node-key="agt_a"]');
    if (handle === null) throw new Error("没有连接手柄");
    // 拖到乙的节点上(测试环境 rect 全零,图形坐标即 client 坐标)
    const target = layoutGraph(AGENTS).nodes.find((node) => node.key === "agt_b");
    if (target === undefined) throw new Error("没有目标节点");

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: target.x + 10, clientY: target.y + 10, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: target.x + 10, clientY: target.y + 10, button: 0 });

    const saveButton = screen.getAllByRole("button", { name: "保存委派" })[0];
    if (saveButton === undefined) throw new Error("没有保存按钮");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(setAgentTargets).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(setAgentTargets).mock.calls[0]?.[0]).toBe("agt_a");
  });
});
