import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAgents, type AgentRosterSummary } from "../../api/identity.js";
import { AgentManagementTable } from "./AgentManagementTable.js";

vi.mock("../../api/identity.js", () => ({
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
    status: "active",
    allowedTargets: [],
    createdAt: 0,
    updatedAt: 0,
    key: null,
    usageLimit: null,
    machineHostname: "build-box",
    totalRuns: 3,
    totalTokens: 1200,
    openTasks: 1,
    lastRunAt: null,
    ...overrides,
  };
}

function renderTable(onEdit = vi.fn()): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AgentManagementTable liveAgents={[]} onEdit={onEdit} onRotateKey={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("Agent 管理表格", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("渲染名册行：显示名、项目、机器、启停状态与累计运行", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent(),
      agent({
        id: "agt_b",
        displayName: "测试 Agent",
        project: "e2e",
        status: "disabled",
        machineId: "m2",
        machineHostname: "test-box",
        totalRuns: 0,
        totalTokens: 0,
      }),
    ]);
    renderTable();

    expect(await screen.findByText("构建 Agent")).toBeTruthy();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("build-box")).toBeTruthy();
    expect(table.getByText("3 次")).toBeTruthy();
    expect(table.getByText("已停用")).toBeTruthy();
    expect(table.getByText("1,200 tok")).toBeTruthy();
  });

  it("关键词过滤只留下命中的 Agent", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent(),
      agent({ id: "agt_b", displayName: "测试 Agent", project: "e2e" }),
    ]);
    renderTable();

    const search = await screen.findByLabelText("搜索 Agent");
    fireEvent.change(search, { target: { value: "e2e" } });

    expect(screen.queryByText("构建 Agent")).toBeNull();
    expect(screen.getByText("测试 Agent")).toBeTruthy();
  });

  it("按启停筛选只留下已停用的 Agent", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent(),
      agent({ id: "agt_b", displayName: "测试 Agent", status: "disabled" }),
    ]);
    renderTable();

    fireEvent.change(await screen.findByLabelText("按启停筛选"), {
      target: { value: "disabled" },
    });

    expect(screen.queryByText("构建 Agent")).toBeNull();
    expect(screen.getByText("测试 Agent")).toBeTruthy();
  });

  it("点击行进入管理", async () => {
    const onEdit = vi.fn();
    vi.mocked(fetchAgents).mockResolvedValue([agent()]);
    renderTable(onEdit);

    fireEvent.click(await screen.findByText("构建 Agent"));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0]?.[0]).toMatchObject({ id: "agt_a" });
  });

  it("行内动作按钮不连带触发行点击", async () => {
    const onEdit = vi.fn();
    vi.mocked(fetchAgents).mockResolvedValue([agent()]);
    renderTable(onEdit);

    fireEvent.click(await screen.findByRole("button", { name: "密钥" }));

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("名册为空时给引导空态", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([]);
    renderTable();

    expect(await screen.findByText("名册里还没有 Agent")).toBeTruthy();
  });
});
