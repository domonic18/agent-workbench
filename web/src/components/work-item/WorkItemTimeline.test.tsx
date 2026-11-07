import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkItemEvent, WorkItemEventsResponse } from "../../api/work-items.js";
import { WorkItemTimeline } from "./WorkItemTimeline.js";

function event(seq: number, kind: string): WorkItemEvent {
  return {
    id: `wev_${seq}`,
    seq,
    kind,
    triggerId: null,
    evidenceRefs: [],
    payload: null,
    occurredAt: 1_700_000_000_000 + seq * 1_000,
  };
}

function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function stubApi(pages: WorkItemEventsResponse[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => fakeResponse(pages.shift() ?? { items: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderTimeline(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkItemTimeline workItemId="wim_1" />
    </QueryClientProvider>,
  );
}

describe("工作事项时间线", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("按 seq 渲染事件并给未知 kind 回退原值", async () => {
    stubApi([{ items: [event(1, "routed"), event(2, "custom_kind")], nextCursor: null }]);
    renderTimeline();

    expect(await screen.findByText("已路由")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("custom_kind")).toBeTruthy();
  });

  it("没有事件时给出空态", async () => {
    stubApi([{ items: [], nextCursor: null }]);
    renderTimeline();

    expect(await screen.findByText("暂无事件记录")).toBeTruthy();
  });

  it("还有后续页时按钮是「加载更多事件」并按 seq 续取", async () => {
    const fetchMock = stubApi([
      { items: [event(1, "routed")], nextCursor: 1 },
      { items: [event(2, "assigned")], nextCursor: null },
    ]);
    renderTimeline();

    const more = await screen.findByRole("button", { name: "加载更多事件" });
    fireEvent.click(more);

    expect(await screen.findByText("已派工")).toBeTruthy();
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls).toContain("/api/work-items/wim_1/events?cursor=1&limit=200");
    });
  });
});
