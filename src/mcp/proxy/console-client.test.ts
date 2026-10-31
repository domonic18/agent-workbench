import { afterEach, describe, expect, it, vi } from "vitest";
import { callConsole, type ConsoleClientConfig } from "./console-client.js";

const CONFIG: ConsoleClientConfig = {
  baseUrl: "http://console.test:8787",
  agentId: "agt_1",
  agentSecret: "secret-1",
};

function stubFetch(handler: (url: URL, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callConsole", () => {
  it("写操作带 Bearer、JSON 与 Idempotency-Key,解析 JSON 响应", async () => {
    const fetchMock = stubFetch(
      async () => new Response(JSON.stringify({ task: { id: "tsk_1" } }), { status: 201 }),
    );

    const result = await callConsole(CONFIG, {
      method: "POST",
      path: "/api/tasks",
      body: { title: "t" },
      idempotencyKey: "idem-1",
    });

    expect(result).toEqual({ status: 201, body: { task: { id: "tsk_1" } } });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://console.test:8787/api/tasks");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      authorization: "Bearer agt_1.secret-1",
      "content-type": "application/json",
      "idempotency-key": "idem-1",
    });
    expect(init.body).toBe(JSON.stringify({ title: "t" }));
  });

  it("读操作拼 query,不带 body 与 content-type", async () => {
    const fetchMock = stubFetch(async () => new Response("null", { status: 200 }));

    await callConsole(CONFIG, {
      method: "GET",
      path: "/api/a2a/inbox",
      query: { cursor: "1:msg_1", wait: "25s" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("cursor")).toBe("1:msg_1");
    expect(url.searchParams.get("wait")).toBe("25s");
    expect(init.headers).toEqual({ authorization: "Bearer agt_1.secret-1" });
    expect(init.body).toBeUndefined();
  });

  it("非 2xx 原样返回错误体,不抛错", async () => {
    const error = { error: { code: "FORBIDDEN", message: "不在白名单", detail: { allowedTargets: [] } } };
    stubFetch(async () => new Response(JSON.stringify(error), { status: 403 }));

    await expect(
      callConsole(CONFIG, { method: "POST", path: "/api/a2a/messages", body: {}, idempotencyKey: "k" }),
    ).resolves.toEqual({ status: 403, body: error });
  });

  it("超时即中止请求", async () => {
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    await expect(
      callConsole(CONFIG, { method: "GET", path: "/api/a2a/inbox", timeoutMs: 5 }),
    ).rejects.toThrow("aborted");
  });
});
