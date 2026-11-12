import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client.js";
import { fetchAgents, setAgentTargets, type AgentRosterSummary } from "../../api/identity.js";
import { DelegationMatrix } from "./DelegationMatrix.js";

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

function renderMatrix(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DelegationMatrix />
    </QueryClientProvider>,
  );
}

/** 默认视图是关系图;矩阵断言前先切到表格视图 */
async function renderTableView(): Promise<void> {
  renderMatrix();
  fireEvent.click(await screen.findByRole("button", { name: "表格视图" }));
}

describe("委派矩阵", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("默认渲染关系图,可切换到表格视图", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent("agt_a", "Agent A", ["agt_b"]),
      agent("agt_b", "Agent B"),
    ]);
    renderMatrix();

    expect(
      await screen.findByRole("button", { name: "Agent A（委派 1 方）" }),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: "委派关系图" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "表格视图" }));

    expect(
      await screen.findByRole("checkbox", { name: "Agent A 委派给 Agent B" }),
    ).toBeTruthy();
  });

  it("表格视图默认展示已保存的勾选,自我格不可勾", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent("agt_a", "Agent A", ["agt_b"]),
      agent("agt_b", "Agent B"),
      agent("agt_c", "Agent C"),
    ]);
    await renderTableView();

    const self = (await screen.findByRole("checkbox", {
      name: "Agent A 委派给 Agent A",
    })) as HTMLInputElement;
    expect(self.disabled).toBe(true);
    expect(self.checked).toBe(false);

    expect(
      (screen.getByRole("checkbox", { name: "Agent A 委派给 Agent B" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "Agent B 委派给 Agent C" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect((screen.getByRole("button", { name: "保存委派" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("表格视图只保存变更过的发起方行", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent("agt_a", "Agent A"),
      agent("agt_b", "Agent B"),
      agent("agt_c", "Agent C"),
    ]);
    vi.mocked(setAgentTargets).mockResolvedValue({
      agent: agent("agt_b", "Agent B", ["agt_c"]),
    });
    await renderTableView();

    fireEvent.click(await screen.findByRole("checkbox", { name: "Agent B 委派给 Agent C" }));
    fireEvent.click(screen.getByRole("button", { name: "保存委派" }));

    await waitFor(() => expect(setAgentTargets).toHaveBeenCalledTimes(1));
    expect(setAgentTargets).toHaveBeenCalledWith("agt_b", ["agt_c"]);
  });

  it("表格视图保存失败时保留勾选并展示服务端消息", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent("agt_a", "Agent A"),
      agent("agt_b", "Agent B"),
    ]);
    vi.mocked(setAgentTargets).mockRejectedValue(
      new ApiError(422, "VALIDATION_FAILED", "委派目标不存在: agt_b"),
    );
    await renderTableView();

    fireEvent.click(await screen.findByRole("checkbox", { name: "Agent A 委派给 Agent B" }));
    fireEvent.click(screen.getByRole("button", { name: "保存委派" }));

    expect(await screen.findByText("委派目标不存在: agt_b")).toBeTruthy();
    expect(
      (screen.getByRole("checkbox", { name: "Agent A 委派给 Agent B" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
