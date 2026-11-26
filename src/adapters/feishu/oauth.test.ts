import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeFeishuCode, FeishuOauthError } from "./oauth.js";

const CREDENTIALS = { appId: "cli_app", appSecret: "sec_app" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const tokenOk = () => jsonResponse(200, { access_token: "u-at-token" });
const userOk = () =>
  jsonResponse(200, { code: 0, data: { open_id: "ou_member", union_id: "un_member", name: "管理员" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exchangeFeishuCode", () => {
  it("成功链:code 换 token 再拉用户信息", async () => {
    const fetchMock = vi
      .fn(async (_url: unknown, _init?: unknown) => tokenOk())
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(userOk());
    vi.stubGlobal("fetch", fetchMock);

    const user = await exchangeFeishuCode("auth-code-1234", CREDENTIALS);
    expect(user).toEqual({ openId: "ou_member", unionId: "un_member", name: "管理员" });

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toBe("https://open.feishu.cn/open-apis/authen/v2/oauth/token");
    expect(JSON.parse(String(calls[0]?.[1]?.body)).client_secret).toBe("sec_app");
    expect(JSON.stringify(calls[1]?.[1]?.headers)).toContain("u-at-token");
  });

  it("token 兑换失败回 FEISHU_CODE_INVALID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: "invalid_grant", error_description: "code expired" })),
    );
    const err = await exchangeFeishuCode("auth-code-1234", CREDENTIALS).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(FeishuOauthError);
    expect(err).toMatchObject({ code: "FEISHU_CODE_INVALID", status: 401 });
  });

  it("user_info 业务码非 0 回 FEISHU_USERINFO_FAILED", async () => {
    const fetchMock = vi
      .fn(async (_url: unknown, _init?: unknown) => tokenOk())
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(jsonResponse(200, { code: 99996010, msg: "invalid access token" }));
    vi.stubGlobal("fetch", fetchMock);

    const err = await exchangeFeishuCode("auth-code-1234", CREDENTIALS).catch((error: unknown) => error);
    expect(err).toMatchObject({ code: "FEISHU_USERINFO_FAILED", status: 401 });
  });

  it("网络不可达回 FEISHU_UNREACHABLE,错误消息不含 appSecret", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("connect ECONNREFUSED"))));
    const err = (await exchangeFeishuCode("auth-code-1234", CREDENTIALS).catch(
      (error: unknown) => error,
    )) as FeishuOauthError;
    expect(err).toMatchObject({ code: "FEISHU_UNREACHABLE", status: 502 });
    expect(err.message).not.toContain("sec_app");
  });
});
