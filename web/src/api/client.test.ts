import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, UNAUTHORIZED_EVENT } from "./client.js";

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("REST 客户端", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => fakeResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("只读请求不带 CSRF 头,写请求带", async () => {
    await api.get("/api/overview");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: { Accept: "application/json" },
    });

    await api.post("/api/auth/login", { password: "x" });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ password: "x" }),
    });
  });

  it("错误体映射为 ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(422, { error: { code: "VALIDATION_FAILED", message: "口令为空" } }),
    );
    await expect(api.post("/api/auth/login", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      code: "VALIDATION_FAILED",
      message: "口令为空",
    });
  });

  it("401 广播未授权事件", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(401, { error: { code: "UNAUTHORIZED", message: "未登录" } }),
    );
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    await expect(api.get("/api/overview")).rejects.toBeInstanceOf(ApiError);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    expect(listener).toHaveBeenCalledOnce();
  });
});
