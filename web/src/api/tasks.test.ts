import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchTask,
  fetchTaskA2a,
  fetchTaskEvents,
  fetchTasks,
  readTaskFilters,
} from "./tasks.js";

function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("任务 API", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => fakeResponse({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("列表查询编码筛选、游标与页大小", async () => {
    await fetchTasks({
      status: "blocked",
      project: "aw 工作台",
      assignee: "agt_1",
      cursor: "10:tsk_1",
      limit: 20,
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      "/api/tasks?status=blocked&project=aw+%E5%B7%A5%E4%BD%9C%E5%8F%B0&assignee=agt_1&cursor=10%3Atsk_1&limit=20",
    );
  });

  it("详情与事件路径对任务 id 转义", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ task: { id: "tsk_1" } }))
      .mockResolvedValueOnce(fakeResponse({ items: [], nextCursor: null }))
      .mockResolvedValueOnce(fakeResponse({ threads: [] }));

    await fetchTask("tsk/a b");
    await fetchTaskEvents("tsk/a b", 12, 30);
    await fetchTaskA2a("tsk/a b");

    const [taskUrl] = fetchMock.mock.calls[0] as unknown as [string];
    const [eventsUrl] = fetchMock.mock.calls[1] as unknown as [string];
    const [a2aUrl] = fetchMock.mock.calls[2] as unknown as [string];
    expect(taskUrl).toBe("/api/tasks/tsk%2Fa%20b");
    expect(eventsUrl).toBe("/api/tasks/tsk%2Fa%20b/events?cursor=12&limit=30");
    expect(a2aUrl).toBe("/api/tasks/tsk%2Fa%20b/a2a");
  });
});

describe("任务筛选解析", () => {
  it("只接受已知状态并去掉空值", () => {
    expect(
      readTaskFilters(
        new URLSearchParams({ status: "blocked", project: "  aw  ", assignee: " " }),
      ),
    ).toEqual({ status: "blocked", project: "aw", assignee: null });
  });

  it("非法状态按未筛选处理", () => {
    expect(readTaskFilters(new URLSearchParams({ status: "bogus" }))).toEqual({
      status: null,
      project: null,
      assignee: null,
    });
  });
});
