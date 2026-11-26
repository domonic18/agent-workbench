import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";

const auth = await import("../api/auth.js");
vi.mock("../api/auth.js", () => ({
  login: vi.fn(),
  logout: vi.fn(),
  feishuStatus: vi.fn(),
  feishuLogin: vi.fn(),
}));

const bootstrap = await import("../api/bootstrap.js");
vi.mock("../api/bootstrap.js", () => ({
  bootstrapStatus: vi.fn(),
}));

const jsapi = await import("../components/auth/feishu-jsapi.js");
vi.mock("../components/auth/feishu-jsapi.js", () => ({
  requestFeishuAuthCode: vi.fn(),
}));

import { LoginPage } from "./LoginPage.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.feishuStatus).mockResolvedValue({ enabled: false, appId: "" });
});

afterEach(() => {
  cleanup();
});

function renderPage(next = "/overview"): void {
  render(
    <MemoryRouter initialEntries={[`/login?next=${next}`]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/overview" element={<div>总览页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginPage 口令登录", () => {
  it("控制台未初始化(BOOTSTRAP_REQUIRED)时给出前往 /setup 的引导", async () => {
    vi.mocked(auth.login).mockRejectedValueOnce(
      new ApiError(403, "BOOTSTRAP_REQUIRED", "控制台未初始化,请先在 /setup 完成管理员设置"),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("控制台口令"), { target: { value: "whatever" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /前往 \/setup/ })).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("控制台未初始化");
  });

  it("普通口令错误不出现 /setup 引导", async () => {
    vi.mocked(auth.login).mockRejectedValueOnce(
      new ApiError(401, "UNAUTHORIZED", "口令错误"),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("控制台口令"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("口令错误"));
    expect(screen.queryByRole("link", { name: /前往 \/setup/ })).toBeNull();
  });
});

describe("LoginPage 飞书免登", () => {
  it("免登关闭时直出口令表单,不出现免登入口", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("控制台口令")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "使用飞书免登" })).toBeNull();
    expect(jsapi.requestFeishuAuthCode).not.toHaveBeenCalled();
  });

  it("免登开启时自动取 code 登录并落到目标页", async () => {
    vi.mocked(auth.feishuStatus).mockResolvedValue({ enabled: true, appId: "cli_app" });
    vi.mocked(jsapi.requestFeishuAuthCode).mockResolvedValue("auth-code-1234");
    vi.mocked(auth.feishuLogin).mockResolvedValue({ ok: true, expiresAt: 1 });
    vi.mocked(bootstrap.bootstrapStatus).mockResolvedValue({ phase: "ready" } as never);

    renderPage("/overview");
    await waitFor(() => expect(screen.getByText("总览页")).toBeTruthy());
    expect(jsapi.requestFeishuAuthCode).toHaveBeenCalledWith("cli_app");
    expect(auth.feishuLogin).toHaveBeenCalledWith("auth-code-1234");
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("免登环境不支持时回落口令表单并给出重试入口", async () => {
    vi.mocked(auth.feishuStatus).mockResolvedValue({ enabled: true, appId: "cli_app" });
    vi.mocked(jsapi.requestFeishuAuthCode).mockRejectedValue(
      new Error("当前环境不支持飞书免登,请使用口令登录 [ready=0]"),
    );

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "使用飞书免登" })).toBeTruthy());
    expect(screen.getByText(/飞书免登未完成/)).toBeTruthy();
    expect(screen.getByLabelText("控制台口令")).toBeTruthy();
  });

  it("免登被服务端拒绝(未在白名单)时回落并展示原因", async () => {
    vi.mocked(auth.feishuStatus).mockResolvedValue({ enabled: true, appId: "cli_app" });
    vi.mocked(jsapi.requestFeishuAuthCode).mockResolvedValue("auth-code-1234");
    vi.mocked(auth.feishuLogin).mockRejectedValue(
      new ApiError(401, "UNAUTHORIZED", "该飞书账号无权登录"),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText("该飞书账号无权登录")).toBeTruthy());
    expect(screen.getByRole("button", { name: "使用飞书免登" })).toBeTruthy();
  });
});
