import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as bootstrap from "../../api/bootstrap.js";
import type { DiscoveryMachineView } from "../../api/bootstrap.js";
import { ToastProvider } from "../ui/Toast.js";
import { OnlineMachines } from "./OnlineMachines.js";

vi.mock("../../api/bootstrap.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchDiscovery: vi.fn(),
}));

function machine(overrides: Partial<DiscoveryMachineView>): DiscoveryMachineView {
  return {
    machineId: "mch_1",
    hostname: "box",
    displayName: null,
    status: "active",
    lastSeenAt: 1_700_000_000_000,
    receivedAt: 1_700_000_000_000,
    collectorVersion: "0.3.1",
    upgradeAvailable: false,
    projects: [],
    ...overrides,
  };
}

function renderList(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <OnlineMachines />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("OnlineMachines 采集器版本展示", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(bootstrap.fetchDiscovery).mockReset();
  });

  it("机器行展示心跳回报的采集器版本;落后于镜像最新版时标可升级", async () => {
    vi.mocked(bootstrap.fetchDiscovery).mockResolvedValue({
      latestCollectorVersion: "0.3.1",
      machines: [
        machine({ machineId: "mch_old", collectorVersion: "0.2.2", upgradeAvailable: true }),
        machine({ machineId: "mch_new" }),
      ],
    });
    renderList();

    await screen.findByText(/mch_old/);
    expect(screen.getByText(/采集器 v0\.2\.2/)).toBeTruthy();
    expect(screen.getByText(/采集器 v0\.3\.1/)).toBeTruthy();
    expect(screen.getByText("可升级到 v0.3.1")).toBeTruthy();
    // 两台都 active;已是最新的那台不出升级徽标(徽标全文只出现一次)
    expect(screen.getAllByText("已激活")).toHaveLength(2);
    expect(screen.getAllByText(/可升级/)).toHaveLength(1);
  });

  it("未发布产物(latest 为 null)时不出现升级徽标", async () => {
    vi.mocked(bootstrap.fetchDiscovery).mockResolvedValue({
      latestCollectorVersion: null,
      machines: [machine({ collectorVersion: "0.2.2" })],
    });
    renderList();

    await screen.findByText(/mch_1/);
    expect(screen.queryByText(/可升级/)).toBeNull();
  });
});
