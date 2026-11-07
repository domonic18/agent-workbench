import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityDto } from "../api/capabilities.js";
import { fetchCapabilities } from "../api/capabilities.js";
import { CapabilitiesPage } from "./CapabilitiesPage.js";

vi.mock("../api/capabilities.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/capabilities.js")>();
  return { ...actual, fetchCapabilities: vi.fn() };
});

vi.mock("../api/identity.js", () => ({
  fetchAgents: vi.fn(async () => []),
  setAgentTargets: vi.fn(),
}));

const NOW = 1_700_000_000_000;

function capability(overrides: Partial<CapabilityDto> = {}): CapabilityDto {
  return {
    id: "cap_1",
    subject: "agent:codex",
    target: "db:prod",
    action: "read",
    scope: {},
    ttlSeconds: 900,
    status: "active",
    ticketId: "tkt_1",
    taskId: "tsk_1",
    issuedAt: NOW,
    expiresAt: NOW + 600_000,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function renderPage(entry: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <CapabilitiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("授权屏", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("缺省视图为待批,空态说明申请来源", async () => {
    vi.mocked(fetchCapabilities).mockResolvedValue({ items: [], nextCursor: null });
    renderPage("/capabilities");

    expect(await screen.findByText("没有待批授权")).toBeTruthy();
    expect(fetchCapabilities).toHaveBeenCalledWith("pending", undefined);
    expect(
      screen.getByRole("tab", { name: "待批" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("按 URL 视图请求并渲染生效卡片", async () => {
    vi.mocked(fetchCapabilities).mockResolvedValue({
      items: [capability()],
      nextCursor: null,
    });
    renderPage("/capabilities?view=active");

    expect(await screen.findByText("db:prod")).toBeTruthy();
    expect(fetchCapabilities).toHaveBeenCalledWith("active", undefined);
    expect(screen.getByRole("tab", { name: "生效" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("剩余有效期")).toBeTruthy();
  });

  it("切换 tab 改 URL 并换取历史视图", async () => {
    vi.mocked(fetchCapabilities).mockResolvedValue({ items: [], nextCursor: null });
    renderPage("/capabilities");

    fireEvent.click(screen.getByRole("tab", { name: "历史" }));

    await waitFor(() => expect(fetchCapabilities).toHaveBeenCalledWith("history", undefined));
    expect(await screen.findByText("暂无历史授权")).toBeTruthy();
  });
});
