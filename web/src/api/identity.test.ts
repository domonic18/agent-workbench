import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgent,
  createMachine,
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

  it("注册 Agent 与机器时带幂等键与 CSRF 头", async () => {
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

    fetchMock.mockResolvedValueOnce(fakeResponse({ machine: {}, secret: "s" }));
    await createMachine({ id: "m1", hostname: "box", os: "macOS", collectorVersion: "0.1.0" });

    const [machineUrl, machineInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(machineUrl).toBe("/api/machines");
    expect((machineInit.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
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
