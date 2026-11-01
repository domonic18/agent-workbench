import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCallAudit } from "../../shared/audit.js";
import { postToolCallAudit } from "./audit-client.js";
import type { ConsoleClientConfig } from "./console-client.js";

const CONFIG: ConsoleClientConfig = {
  baseUrl: "http://console.test:8787",
  agentId: "agt_1",
  agentSecret: "secret-1",
};

const ENTRY: ToolCallAudit = {
  runId: "run_1",
  taskId: "tsk_1",
  tool: "task.create",
  argsHash: "a".repeat(64),
  level: "L1",
  verdict: "allow",
  reason: null,
  capabilityId: null,
  durationMs: null,
  occurredAt: 1_700_000_000_000,
};

function stubFetch(handler: (url: URL, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postToolCallAudit", () => {
  it("以 Bearer 上报审计负载,不带幂等键", async () => {
    const fetchMock = stubFetch(async () => new Response('{"ok":true}', { status: 201 }));

    await postToolCallAudit(CONFIG, ENTRY);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://console.test:8787/api/audit/tool-calls");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      authorization: "Bearer agt_1.secret-1",
      "content-type": "application/json",
    });
    expect(init.body).toBe(JSON.stringify(ENTRY));
  });

  it("非 2xx 抛错,供上层拒绝执行", async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "FORBIDDEN", message: "任务不属于当前 Agent" } }),
          { status: 403 },
        ),
    );

    await expect(postToolCallAudit(CONFIG, ENTRY)).rejects.toThrow(
      /HTTP 403.*FORBIDDEN.*任务不属于当前 Agent/,
    );
  });
});
