import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../ui/Toast.js";

const bootstrap = await import("../../../api/bootstrap.js");
vi.mock("../../../api/bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/bootstrap.js")>();
  return {
    ...actual,
    fetchDiscovery: vi.fn(),
    confirmAgents: vi.fn(async () => ({ agents: [] })),
  };
});

import { StepProjects } from "./StepProjects.js";

const MACHINES = [
  {
    machineId: "mch_mac",
    hostname: "mac-box",
    displayName: null,
    status: "active",
    lastSeenAt: 1_700_000_000_000,
    receivedAt: 1_700_000_000_000,
    projects: [{ name: "alpha", confirmed: false }, { name: "beta", confirmed: false }],
  },
  {
    machineId: "mch_mini",
    hostname: "mini-box",
    displayName: null,
    status: "active",
    lastSeenAt: 1_700_000_000_000,
    receivedAt: 1_700_000_000_000,
    projects: [{ name: "gamma", confirmed: false }],
  },
];

function renderStep(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <StepProjects />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bootstrap.fetchDiscovery).mockResolvedValue({ machines: MACHINES });
});

afterEach(() => {
  cleanup();
});

describe("StepProjects", () => {
  it("按机器分别确认项目,不把跨机项目并到同一台机", async () => {
    renderStep();
    await screen.findByText("mac-box");

    fireEvent.click(screen.getByRole("button", { name: "确认项目与主责 Agent" }));

    await waitFor(() => expect(bootstrap.confirmAgents).toHaveBeenCalledTimes(2));
    expect(bootstrap.confirmAgents).toHaveBeenCalledWith("mch_mac", [
      { project: "alpha" },
      { project: "beta" },
    ]);
    expect(bootstrap.confirmAgents).toHaveBeenCalledWith("mch_mini", [{ project: "gamma" }]);
  });

  it("取消勾选的项目不进确认请求", async () => {
    renderStep();
    await screen.findByText("mac-box");

    const beta = screen.getByText(/beta/).closest("label");
    fireEvent.click(beta?.querySelector("input") as HTMLInputElement);
    fireEvent.click(screen.getByRole("button", { name: "确认项目与主责 Agent" }));

    await waitFor(() => expect(bootstrap.confirmAgents).toHaveBeenCalledTimes(2));
    expect(bootstrap.confirmAgents).toHaveBeenCalledWith("mch_mac", [{ project: "alpha" }]);
  });
});
