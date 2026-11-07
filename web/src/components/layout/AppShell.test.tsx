import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logout } from "../../api/auth.js";
import { ThemeProvider } from "../../shared/theme.js";
import { AppShell } from "./AppShell.js";

vi.mock("../../api/auth.js", () => ({
  logout: vi.fn(async () => undefined),
}));

class FakeEventSource {
  onerror: (() => void) | null = null;

  constructor(_url: string) {}

  addEventListener(): void {}

  close(): void {}
}

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderShell(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={["/overview"]}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <Routes>
            <Route path="/login" element={<LocationProbe />} />
            <Route path="/*" element={<AppShell />} />
          </Routes>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("应用外壳", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.mocked(logout).mockClear();
    localStorage.clear();
  });

  it("侧栏按分组列出导航，顶栏右侧放主题开关与头像", () => {
    renderShell();

    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
    expect(screen.getByText("工作台")).toBeTruthy();
    expect(screen.getByText("治理")).toBeTruthy();
    expect(screen.getByRole("link", { name: "总览" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "任务" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "授权" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "知识" })).toBeTruthy();

    expect(screen.getByRole("button", { name: "切换到暗黑模式" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "账号菜单" })).toBeTruthy();
  });

  it("主题开关在明亮与暗黑之间切换", () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: "切换到暗黑模式" }));
    expect(screen.getByRole("button", { name: "切换到明亮模式" })).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("账号菜单含外观三选与退出登录", () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "跟随系统" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "明亮" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "暗黑" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeTruthy();
  });

  it("退出登录会调接口并跳回登录页", async () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("pathname").textContent).toBe("/login");
    });
  });
});
