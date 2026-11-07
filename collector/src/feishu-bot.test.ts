import { describe, expect, it } from "vitest";
import {
  createCachedFeishuBotResolver,
  fetchFeishuBotIdentity,
  type FetchLike,
} from "./feishu-bot.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchFeishuBotIdentity", () => {
  it("换取租户 token 后取 bot/v3/info 返回 name 与 openId", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = (async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("tenant_access_token")) {
        return jsonResponse({ code: 0, tenant_access_token: "t-123" });
      }
      return jsonResponse({ code: 0, bot: { app_name: "测试专家", open_id: "ou_bot" } });
    }) as FetchLike;

    const result = await fetchFeishuBotIdentity("cli_a", "secret", fetchImpl);
    expect(result).toEqual({ name: "测试专家", openId: "ou_bot" });
    expect(calls).toHaveLength(2);
  });

  it("token 换取失败返回 undefined", async () => {
    const fetchImpl: FetchLike = (async () =>
      jsonResponse({ code: 99991672, msg: "invalid secret" })) as FetchLike;
    await expect(fetchFeishuBotIdentity("cli_a", "bad", fetchImpl)).resolves.toBeUndefined();
  });

  it("bot 信息缺 open_id 返回 undefined", async () => {
    const fetchImpl: FetchLike = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes("tenant_access_token")) {
        return jsonResponse({ code: 0, tenant_access_token: "t-123" });
      }
      return jsonResponse({ code: 0, bot: { app_name: "无 open_id" } });
    }) as FetchLike;
    await expect(fetchFeishuBotIdentity("cli_a", "secret", fetchImpl)).resolves.toBeUndefined();
  });

  it("网络异常返回 undefined 不抛错", async () => {
    const fetchImpl: FetchLike = (async () => {
      throw new Error("network down");
    }) as FetchLike;
    await expect(fetchFeishuBotIdentity("cli_a", "secret", fetchImpl)).resolves.toBeUndefined();
  });
});

interface FetchCounter {
  calls: string[];
  okCount: number;
  failAfter?: number;
}

function botFetch(counter: FetchCounter): FetchLike {
  return (async (input: string | URL) => {
    const url = String(input);
    if (counter.failAfter !== undefined && counter.calls.length >= counter.failAfter) {
      throw new Error("network down");
    }
    counter.calls.push(url);
    if (url.includes("tenant_access_token")) {
      return jsonResponse({ code: 0, tenant_access_token: `t-${counter.okCount++}` });
    }
    return jsonResponse({ code: 0, bot: { app_name: "测试专家", open_id: "ou_bot" } });
  }) as FetchLike;
}

describe("createCachedFeishuBotResolver", () => {
  it("bot 名按项目缓存:重复 resolve 不重复请求飞书", async () => {
    const counter: FetchCounter = { calls: [] as string[], okCount: 0 };
    const resolver = createCachedFeishuBotResolver({ fetchImpl: botFetch(counter) });
    const first = await resolver.resolve("cli_a", "secret", "proj-a");
    const second = await resolver.resolve("cli_a", "secret", "proj-a");
    expect(first).toEqual({ name: "测试专家", openId: "ou_bot" });
    expect(second).toEqual(first);
    expect(counter.calls).toHaveLength(2);
  });

  it("token 按 appId 缓存:同应用多项目只换一次 token", async () => {
    const counter: FetchCounter = { calls: [] as string[], okCount: 0 };
    const resolver = createCachedFeishuBotResolver({ fetchImpl: botFetch(counter) });
    await resolver.resolve("cli_a", "secret", "proj-a");
    await resolver.resolve("cli_a", "secret", "proj-b");
    const tokenCalls = counter.calls.filter((url) => url.includes("tenant_access_token"));
    expect(tokenCalls).toHaveLength(1);
    expect(counter.calls).toHaveLength(3);
  });

  it("缓存过期后现取失败,沿用上一次成功值而非闪回", async () => {
    const counter: FetchCounter = { calls: [] as string[], okCount: 0 };
    let nowMs = 0;
    const resolver = createCachedFeishuBotResolver({
      fetchImpl: botFetch(counter),
      now: () => nowMs,
    });
    const cached = await resolver.resolve("cli_a", "secret", "proj-a");
    expect(cached).toEqual({ name: "测试专家", openId: "ou_bot" });

    nowMs = 8 * 24 * 60 * 60_000;
    counter.failAfter = counter.calls.length;
    const stale = await resolver.resolve("cli_a", "secret", "proj-a");
    expect(stale).toEqual(cached);
  });

  it("invalidateAll 后重新现取,token 复用不清(手动刷新路径)", async () => {
    const counter: FetchCounter = { calls: [] as string[], okCount: 0 };
    const resolver = createCachedFeishuBotResolver({ fetchImpl: botFetch(counter) });
    await resolver.resolve("cli_a", "secret", "proj-a");
    expect(counter.calls).toHaveLength(2);
    resolver.invalidateAll();
    await resolver.resolve("cli_a", "secret", "proj-a");
    // 只重打 bot/v3/info,token 命中缓存不重新换
    expect(counter.calls.filter((url) => url.includes("bot/v3/info"))).toHaveLength(2);
    expect(counter.calls).toHaveLength(3);
  });
});
