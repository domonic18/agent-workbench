import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOWLEDGE_INDEX } from "../../shared/constants.js";
import { createEmbeddingClient } from "./embedding.js";

function vector(dimensions: number = KNOWLEDGE_INDEX.dimensions): number[] {
  return Array.from({ length: dimensions }, () => 0.5);
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function client(apiKey?: string) {
  return createEmbeddingClient({
    baseUrl: "http://127.0.0.1:11434/v1/",
    apiKey,
    model: "bge-m3",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createEmbeddingClient", () => {
  it("空输入直接返回,不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().embed([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("请求去掉末尾斜杠并带鉴权头", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      respond({ data: [{ embedding: vector() }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const vectors = await client("sk-test").embed(["部署手册"]);

    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(vectors[0]).toHaveLength(KNOWLEDGE_INDEX.dimensions);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/v1/embeddings");
    expect(init.headers).toMatchObject({ authorization: "Bearer sk-test" });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "bge-m3",
      input: ["部署手册"],
    });
  });

  it("未配置 key 时不带鉴权头", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      respond({ data: [{ embedding: vector() }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await client().embed(["a"]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("返回条数与请求不一致时报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ data: [{ embedding: vector() }] })),
    );
    await expect(client().embed(["a", "b"])).rejects.toThrow(/条数/);
  });

  it("维度不符时报错而不是截断", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ data: [{ embedding: vector(128) }] })),
    );
    await expect(client().embed(["a"])).rejects.toThrow(/维度/);
  });

  it("非 2xx 带出服务端错误信息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ error: { message: "model not found" } }, 404)),
    );
    await expect(client().embed(["a"])).rejects.toThrow(/model not found/);
  });
});
