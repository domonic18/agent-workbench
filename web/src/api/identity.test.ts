import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgent,
  fetchAgentTimeline,
  fetchMachines,
  rotateAgentKey,
} from "./identity.js";

function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("身份 API", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => fakeResponse({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("注册 Agent 时带幂等键与 CSRF 头", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ agent: {}, secret: "s" }));
    await createAgent({ machineId: "m1", project: "aw", displayName: "构建" });

    const [agentUrl, agentInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(agentUrl).toBe("/api/agents");
    expect(agentInit.method).toBe("POST");
    expect(agentInit.headers).toMatchObject({
      "X-Requested-With": "XMLHttpRequest",
    });
    expect((agentInit.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
    expect(agentInit.body).toBe(JSON.stringify({ machineId: "m1", project: "aw", displayName: "构建" }));
  });

  it("对话流按 Agent id 转义并带 limit 与游标", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ items: [], nextCursor: null }));
    await fetchAgentTimeline("agt/a b", { limit: 50, cursor: "10:evt_1" });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("/api/agents/agt%2Fa%20b/timeline");
    expect(url).toContain("limit=50");
    expect(url).toContain("cursor=10%3Aevt_1");
  });

  it("轮换密钥对 Agent id 做路径转义", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ secret: "new" }));
    await rotateAgentKey("agt/a b");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agents/agt%2Fa%20b/rotate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
  });

  it("机器列表按 nextCursor 翻页取全", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ items: [{ id: "m1" }], nextCursor: "10:m1" }))
      .mockResolvedValueOnce(fakeResponse({ items: [{ id: "m2" }], nextCursor: null }));

    const machines = await fetchMachines();

    expect(machines.map((machine) => machine.id)).toEqual(["m1", "m2"]);
    const [firstUrl] = fetchMock.mock.calls[0] as unknown as [string];
    const [secondUrl] = fetchMock.mock.calls[1] as unknown as [string];
    expect(firstUrl).toContain("limit=200");
    expect(secondUrl).toContain("cursor=10%3Am1");
  });
});
