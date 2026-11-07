import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchWorkItem,
  fetchWorkItemEvents,
  fetchWorkItems,
  readWorkItemFilter,
} from "./work-items.js";

function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("工作事项 API", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => fakeResponse({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("列表查询编码注意力、游标与页大小", async () => {
    await fetchWorkItems({ attention: "person", cursor: "10:wim_1", limit: 20 });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/work-items?attention=person&cursor=10%3Awim_1&limit=20");
  });

  it("不带筛选时不拼出空查询串", async () => {
    await fetchWorkItems({});

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/work-items");
  });

  it("详情与事件路径对事项 id 转义", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ workItem: { id: "wim/1" } }))
      .mockResolvedValueOnce(fakeResponse({ items: [], nextCursor: null }));

    await fetchWorkItem("wim/1");
    await fetchWorkItemEvents("wim/1", 12, 30);

    const [detailUrl] = fetchMock.mock.calls[0] as unknown as [string];
    const [eventsUrl] = fetchMock.mock.calls[1] as unknown as [string];
    expect(detailUrl).toBe("/api/work-items/wim%2F1");
    expect(eventsUrl).toBe("/api/work-items/wim%2F1/events?cursor=12&limit=30");
  });
});

describe("工作事项筛选解析", () => {
  it("只接受已知注意力,URL 键是 wi", () => {
    expect(readWorkItemFilter(new URLSearchParams({ wi: "person" }))).toBe("person");
    expect(readWorkItemFilter(new URLSearchParams({ wi: "bogus" }))).toBeNull();
    expect(readWorkItemFilter(new URLSearchParams())).toBeNull();
    // 接口参数名不是 URL 键,拿它当筛选会永远筛不出东西
    expect(readWorkItemFilter(new URLSearchParams({ attention: "person" }))).toBeNull();
  });
});
