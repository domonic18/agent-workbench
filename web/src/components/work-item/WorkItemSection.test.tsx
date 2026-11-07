import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkItemListItem } from "../../api/work-items.js";
import { WorkItemSection } from "./WorkItemSection.js";

function item(overrides: Partial<WorkItemListItem> = {}): WorkItemListItem {
  return {
    id: "wim_1",
    project: "aw",
    kind: "bug_fix",
    title: "修复登录跳转",
    status: "open",
    stage: "execute",
    attention: "none",
    nextAction: null,
    latestSummary: null,
    lastProgressAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="search">{location.search}</span>;
}

function renderSection(initial = "/overview"): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.startsWith("/api/work-items")) {
      return fakeResponse({ items: [item()], nextCursor: null });
    }
    throw new Error(`unexpected ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[initial]}>
      <QueryClientProvider client={client}>
        <WorkItemSection />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe("总览工作事项区块", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("列出工作事项并给出筛选条", async () => {
    renderSection();

    expect(await screen.findAllByText("修复登录跳转")).toBeTruthy();
    expect(screen.getByRole("button", { name: "需要人" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "待验收" })).toBeTruthy();
  });

  it("切筛选时把状态写进 URL 并改服务端查询", async () => {
    const fetchMock = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "需要人" }));

    await waitFor(() => {
      expect(screen.getByTestId("search").textContent).toBe("?wi=person");
    });
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("attention=person"))).toBe(true);
    });
  });

  it("URL 里的筛选直接生效", async () => {
    const fetchMock = renderSection("/overview?wi=blocked");

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("attention=blocked"))).toBe(true);
    });
    expect(screen.getByText(/已筛选「阻塞」/)).toBeTruthy();
  });
});
