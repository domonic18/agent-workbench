import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgent, fetchMachines } from "../../api/identity.js";
import { AgentRegisterDialog } from "./AgentRegisterDialog.js";

vi.mock("../../api/identity.js", () => ({
  createAgent: vi.fn(),
  fetchMachines: vi.fn(),
}));

function renderDialog(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AgentRegisterDialog onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("Agent 注册弹窗", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("选择机器并提交后展示一次性密钥", async () => {
    vi.mocked(fetchMachines).mockResolvedValue([
      {
        id: "m1",
        hostname: "build-box",
        os: "macOS",
        collectorVersion: "0.1.0",
        lastSeenAt: null,
        status: "active",
        createdAt: 1_700_000_000_000,
      },
    ]);
    vi.mocked(createAgent).mockResolvedValue({
      agent: {
        id: "agt_new",
        machineId: "m1",
        project: "aw",
        displayName: "构建 Agent",
        feishuAppId: null,
        status: "active",
        allowedTargets: ["agt_b"],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
      secret: "agent_secret",
    });
    renderDialog();

    expect(await screen.findByRole("option", { name: /build-box/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("机器"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText("项目"), { target: { value: "aw" } });
    fireEvent.change(screen.getByLabelText("显示名"), { target: { value: "构建 Agent" } });
    fireEvent.change(screen.getByLabelText("可委派目标（可选）"), {
      target: { value: "agt_b, agt_c," },
    });
    fireEvent.submit(screen.getByRole("button", { name: "注册" }).closest("form")!);

    expect(await screen.findByText("agent_secret")).toBeTruthy();
    expect(createAgent).toHaveBeenCalledWith({
      machineId: "m1",
      project: "aw",
      displayName: "构建 Agent",
      allowedTargets: ["agt_b", "agt_c"],
    });
    expect(screen.getByText(/AW_AGENT_ID/)).toBeTruthy();
    expect(screen.getByText(/关闭后不可再查看/)).toBeTruthy();
  });

  it("没有机器时提示先登记机器", async () => {
    vi.mocked(fetchMachines).mockResolvedValue([]);
    renderDialog();

    expect(await screen.findByText(/请先用「机器登记」添加一台/)).toBeTruthy();
  });
});
