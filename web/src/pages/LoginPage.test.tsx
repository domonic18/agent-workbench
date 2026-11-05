import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";

const auth = await import("../api/auth.js");
vi.mock("../api/auth.js", () => ({
  login: vi.fn(),
  logout: vi.fn(),
}));

import { LoginPage } from "./LoginPage.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function renderPage(next = "/overview"): void {
  render(
    <MemoryRouter initialEntries={[`/login?next=${next}`]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
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
