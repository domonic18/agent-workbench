import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client.js";
import { fetchAgents, setAgentTargets, type AgentSummary } from "../../api/identity.js";
import { DelegationMatrix } from "./DelegationMatrix.js";

vi.mock("../../api/identity.js", () => ({
  fetchAgents: vi.fn(),
  setAgentTargets: vi.fn(),
}));

function agent(id: string, displayName: string, allowedTargets: string[] = []): AgentSummary {
  return {
    id,
    machineId: "m1",
    project: id,
    displayName,
    feishuAppId: null,
    status: "active",
    allowedTargets,
    createdAt: 0,
    updatedAt: 0,
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

describe("委派矩阵", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("默认展示已保存的勾选,自我格不可勾", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent("agt_a", "Agent A", ["agt_b"]),
      agent("agt_b", "Agent B"),
      agent("agt_c", "Agent C"),
    ]);
    renderMatrix();

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

  it("只保存变更过的发起方行", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent("agt_a", "Agent A"),
      agent("agt_b", "Agent B"),
      agent("agt_c", "Agent C"),
    ]);
    vi.mocked(setAgentTargets).mockResolvedValue({
      agent: agent("agt_b", "Agent B", ["agt_c"]),
    });
    renderMatrix();

    fireEvent.click(await screen.findByRole("checkbox", { name: "Agent B 委派给 Agent C" }));
    fireEvent.click(screen.getByRole("button", { name: "保存委派" }));

    await waitFor(() => expect(setAgentTargets).toHaveBeenCalledTimes(1));
    expect(setAgentTargets).toHaveBeenCalledWith("agt_b", ["agt_c"]);
  });

  it("保存失败时保留勾选并展示服务端消息", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      agent("agt_a", "Agent A"),
      agent("agt_b", "Agent B"),
    ]);
    vi.mocked(setAgentTargets).mockRejectedValue(
      new ApiError(422, "VALIDATION_FAILED", "委派目标不存在: agt_b"),
    );
    renderMatrix();

    fireEvent.click(await screen.findByRole("checkbox", { name: "Agent A 委派给 Agent B" }));
    fireEvent.click(screen.getByRole("button", { name: "保存委派" }));

    expect(await screen.findByText("委派目标不存在: agt_b")).toBeTruthy();
    expect(
      (screen.getByRole("checkbox", { name: "Agent A 委派给 Agent B" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
