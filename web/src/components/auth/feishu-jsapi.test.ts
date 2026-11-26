import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestFeishuAuthCode } from "./feishu-jsapi.js";

type JsapiOpts = Record<string, unknown>;

interface H5SdkLike {
  ready: (fn: () => void) => void;
  requestAccess?: (opts: JsapiOpts) => void;
  requestAuthCode?: (opts: JsapiOpts) => void;
}

function installH5Sdk(sdk: H5SdkLike): void {
  window.h5sdk = sdk as typeof window.h5sdk;
}

function succeed(opts: JsapiOpts): void {
  (opts.success as (r: { code: string }) => void)({ code: "auth-code-from-jsapi" });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete window.h5sdk;
  delete window.tt;
});

describe("requestFeishuAuthCode", () => {
  it("requestAuthCode 可用时直接取到 code", async () => {
    const requestAuthCode = vi.fn((opts: JsapiOpts) => succeed(opts));
    installH5Sdk({ ready: (fn) => fn(), requestAuthCode });

    const code = await requestFeishuAuthCode("cli_app");
    expect(code).toBe("auth-code-from-jsapi");
    expect(requestAuthCode).toHaveBeenCalledWith(expect.objectContaining({ appId: "cli_app" }));
  });

  it("requestAccess 静默 8 秒后回退 requestAuthCode", async () => {
    const requestAccess = vi.fn();
    installH5Sdk({ ready: (fn) => fn(), requestAccess });
    window.tt = undefined;

    const pending = requestFeishuAuthCode("cli_app");
    // 先冲一遍微任务,让 loadH5Sdk 解析、ready 回调执行
    await vi.advanceTimersByTimeAsync(0);
    expect(requestAccess).toHaveBeenCalledTimes(1);

    // 回退前补上 requestAuthCode;模块在调用时才解析 window.tt
    window.tt = { requestAuthCode: (opts: JsapiOpts) => succeed(opts) };
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toBe("auth-code-from-jsapi");
  });

  it("SDK 全程无响应时 20 秒超时拒绝,不无限挂起", async () => {
    installH5Sdk({ ready: (fn) => fn(), requestAccess: vi.fn() });

    const pending = requestFeishuAuthCode("cli_app");
    const expectation = expect(pending).rejects.toThrow(/飞书授权超时/);
    await vi.advanceTimersByTimeAsync(20_000);
    await expectation;
  });

  it("bridge 无可用授权方法时立即拒绝并带诊断串", async () => {
    installH5Sdk({ ready: (fn) => fn() });

    await expect(requestFeishuAuthCode("cli_app")).rejects.toThrow(
      /当前环境不支持飞书免登.*ready=1/s,
    );
  });
});
