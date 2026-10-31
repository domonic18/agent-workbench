import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeTools, type NativeToolsConfig } from "./native.js";

const CONFIG: NativeToolsConfig = {
  baseUrl: "http://console.test:8787",
  agentId: "agt_a",
  agentSecret: "secret-a",
};

function stubFetch(handler: (url: URL, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function tool(name: string) {
  const found = createNativeTools(CONFIG).find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`工具不存在: ${name}`);
  }
  return found;
}

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((entry) => entry.text ?? "").join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("原生工具面", () => {
  it("五个工具各有裸名与点分闸门名", () => {
    expect(createNativeTools(CONFIG).map((entry) => [entry.name, entry.gateName])).toEqual([
      ["task_create", "task.create"],
      ["task_update", "task.update"],
      ["a2a_send", "a2a.send"],
      ["a2a_inbox", "a2a.inbox"],
      ["a2a_ack", "a2a.ack"],
    ]);
  });

  it("task_create 走 POST /api/tasks,丢弃模型自述的身份字段", async () => {
    const fetchMock = stubFetch(async () => ok({ task: { id: "tsk_1" } }));

    const result = await tool("task_create").execute({
      title: "整理契约",
      assigner: "console",
      project: "aw",
      assignee: "agt_b",
      agent_id: "agt_b",
      role: "admin",
    });

    expect(result.isError).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/tasks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      title: "整理契约",
      assigner: "console",
      project: "aw",
    });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("task_update 走 PATCH /api/tasks/:id", async () => {
    const fetchMock = stubFetch(async () => ok({ task: { id: "tsk_1" } }));

    await tool("task_update").execute({ task_id: "tsk_1", status: "running", assignee: "agt_b" });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/tasks/tsk_1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ status: "running" });
  });

  it("a2a_send 走 POST /api/a2a/messages,from/round 不随 body 上传", async () => {
    const fetchMock = stubFetch(async () => ok({ msg_id: "msg_1", thread_id: "thr_1", round: 1 }));

    await tool("a2a_send").execute({
      task_id: "tsk_1",
      to: "agt_b",
      intent: "request",
      summary: "需要契约",
      expect: "OpenAPI",
      from: "agt_b",
      round: 9,
      agent_id: "agt_b",
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/a2a/messages");
    expect(JSON.parse(String(init.body))).toEqual({
      task_id: "tsk_1",
      to: "agt_b",
      intent: "request",
      summary: "需要契约",
      expect: "OpenAPI",
    });
  });

  it("a2a_send 被白名单拒绝时列可达目标", async () => {
    stubFetch(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: "FORBIDDEN",
              message: "目标 Agent agt_c 不在委派白名单内",
              detail: { allowedTargets: ["agt_b"] },
            },
          }),
          { status: 403 },
        ),
      ),
    );

    const result = await tool("a2a_send").execute({
      task_id: "tsk_1",
      to: "agt_c",
      intent: "request",
      summary: "s",
      expect: "e",
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("可达目标: [agt_b]");
  });

  it("a2a_inbox 默认 wait=25s,自定义 wait 转秒并放宽超时", async () => {
    const fetchMock = stubFetch(async () => ok({ items: [], nextCursor: null }));

    await tool("a2a_inbox").execute({});
    await tool("a2a_inbox").execute({ cursor: "1:msg_1", wait: 5 });

    const [firstUrl] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(firstUrl.pathname).toBe("/api/a2a/inbox");
    expect(firstUrl.searchParams.get("wait")).toBe("25s");
    expect(firstUrl.searchParams.has("agent_id")).toBe(false);

    const [secondUrl] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(secondUrl.searchParams.get("cursor")).toBe("1:msg_1");
    expect(secondUrl.searchParams.get("wait")).toBe("5s");
  });

  it("a2a_inbox 拒绝非法 wait", async () => {
    const fetchMock = stubFetch(async () => ok({ items: [] }));

    const result = await tool("a2a_inbox").execute({ wait: 60 });

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a2a_ack 走 ACK 路由且不需要幂等键", async () => {
    const fetchMock = stubFetch(async () => ok({ ok: true }));

    await tool("a2a_ack").execute({ msg_id: "msg_1", task_id: "tsk_b" });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/a2a/inbox/msg_1/ack");
    expect(JSON.parse(String(init.body))).toEqual({ task_id: "tsk_b" });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBeUndefined();
  });

  it("控制台错误体转 isError,网络异常不外抛", async () => {
    stubFetch(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "任务不存在" } }), {
          status: 404,
        }),
      ),
    );
    const missing = await tool("task_update").execute({ task_id: "tsk_404" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("NOT_FOUND: 任务不存在");

    stubFetch(() => Promise.reject(new Error("connect ECONNREFUSED")));
    const offline = await tool("a2a_ack").execute({ msg_id: "msg_1" });
    expect(offline.isError).toBe(true);
    expect(textOf(offline)).toContain("ECONNREFUSED");
  });
});
