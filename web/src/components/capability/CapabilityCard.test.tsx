import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityDto, CapabilityView } from "../../api/capabilities.js";
import {
  approveCapability,
  createCapability,
  revokeCapability,
} from "../../api/capabilities.js";
import { ApiError } from "../../api/client.js";
import { CapabilityCard } from "./CapabilityCard.js";

vi.mock("../../api/capabilities.js", () => ({
  approveCapability: vi.fn(),
  rejectCapability: vi.fn(),
  revokeCapability: vi.fn(),
  createCapability: vi.fn(),
}));

const NOW = 1_700_000_000_000;

function capability(overrides: Partial<CapabilityDto> = {}): CapabilityDto {
  return {
    id: "cap_1",
    subject: "agent:codex",
    target: "db:prod",
    action: "read",
    scope: { tables: ["orders", "users"], mode: "readonly" },
    ttlSeconds: 900,
    status: "pending",
    ticketId: null,
    taskId: "tsk_1",
    issuedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function renderCard(card: CapabilityDto, view: CapabilityView): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CapabilityCard capability={card} view={view} now={NOW} />
    </QueryClientProvider>,
  );
}

describe("授权卡片", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("待批时完整展示范围,不折叠", () => {
    renderCard(capability(), "pending");

    expect(screen.getByText("db:prod")).toBeTruthy();
    expect(screen.getByText("范围（完整展示，不折叠）")).toBeTruthy();
    expect(screen.getByText(/"tables": \[/)).toBeTruthy();
    expect(screen.getByText(/"orders"/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "批准" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeTruthy();
  });

  it("批准进行中按钮置灰并显示签发中", async () => {
    let settle: (() => void) | undefined;
    vi.mocked(approveCapability).mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () => resolve({ applied: true, capability: capability({ status: "active" }) });
        }),
    );
    renderCard(capability(), "pending");

    fireEvent.click(screen.getByRole("button", { name: "批准" }));

    const busy = await screen.findByRole("button", { name: "签发中…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "拒绝" }) as HTMLButtonElement).disabled).toBe(true);

    settle?.();
    await screen.findByRole("button", { name: "批准" });
  });

  it("签发失败给出重试入口,重试按原参数重新申请", async () => {
    vi.mocked(approveCapability).mockRejectedValue(
      new ApiError(503, "UPSTREAM_UNAVAILABLE", "Teleport 不可用"),
    );
    vi.mocked(createCapability).mockResolvedValue({
      capability: capability({ id: "cap_2" }),
    });
    renderCard(capability(), "pending");

    fireEvent.click(screen.getByRole("button", { name: "批准" }));
    expect(await screen.findByText("签发失败，可重试；当前未生效。")).toBeTruthy();
    expect(screen.queryByText("生效")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(createCapability).toHaveBeenCalledTimes(1));
    expect(createCapability).toHaveBeenCalledWith({
      subject: "agent:codex",
      target: "db:prod",
      action: "read",
      scope: { tables: ["orders", "users"], mode: "readonly" },
      ttlSeconds: 900,
      taskId: "tsk_1",
    });
  });

  it("历史视图重新申请失败时直接显示错误", async () => {
    vi.mocked(createCapability).mockRejectedValue(
      new ApiError(503, "UPSTREAM_UNAVAILABLE", "上游不可用"),
    );
    renderCard(capability({ status: "rejected" }), "history");

    fireEvent.click(screen.getByRole("button", { name: "重新申请" }));

    expect(await screen.findByText("上游不可用")).toBeTruthy();
    expect(screen.queryByText("签发失败，可重试；当前未生效。")).toBeNull();
  });

  it("吊销需二次确认", async () => {
    vi.mocked(revokeCapability).mockResolvedValue({
      applied: true,
      capability: capability({ status: "revoked" }),
    });
    renderCard(
      capability({ status: "active", issuedAt: NOW, expiresAt: NOW + 600_000 }),
      "active",
    );

    fireEvent.click(screen.getByRole("button", { name: "吊销" }));
    expect(revokeCapability).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "确认吊销" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认吊销" }));
    await waitFor(() => expect(revokeCapability).toHaveBeenCalledWith("cap_1"));
  });
});
