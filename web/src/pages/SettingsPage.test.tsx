import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast.js";
import { SettingsPage } from "./SettingsPage.js";

function json(body: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => body } as Response;
}

function renderPage(fetchImpl: typeof fetch): void {
  vi.stubGlobal("fetch", fetchImpl);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const SETTINGS_RESPONSE = {
  values: {
    public_url: "https://aw.example.com",
    feishu_app_id: "cli_app",
    feishu_app_secret: true,
    feishu_allowed_open_ids: "ou_1,ou_2",
    task_zombie_hours: "3",
  },
  updatedAt: 1_700_000_000_000,
  updatedBy: "admin",
};

describe("设置页", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("加载后回显当前值,密钥字段不暴露", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/api/settings")) {
        return json(SETTINGS_RESPONSE);
      }
      return json({});
    });
    renderPage(fetcher);

    expect(await screen.findByDisplayValue("https://aw.example.com")).toBeTruthy();
    expect(screen.getByDisplayValue("cli_app")).toBeTruthy();
    expect(screen.getByDisplayValue("ou_1,ou_2")).toBeTruthy();
    expect(screen.getByDisplayValue("3")).toBeTruthy();
    // 密钥字段 placeholder 提示已设置,不暴露值
    const secretInput = screen.getByPlaceholderText("已设置,留空保持不变");
    expect(secretInput).toBeTruthy();
    expect((secretInput as HTMLInputElement).value).toBe("");
  });

  it("保存时只提交变更字段并显示重启提示", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes("/api/settings") && init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        expect(body).toMatchObject({ publicUrl: "https://new.example.com" });
        return json({ ok: true, restartRequired: true });
      }
      if (path.includes("/api/settings")) {
        return json(SETTINGS_RESPONSE);
      }
      return json({});
    });
    renderPage(fetcher);

    const publicUrlInput = await screen.findByDisplayValue("https://aw.example.com");
    fireEvent.change(publicUrlInput, { target: { value: "https://new.example.com" } });

    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      expect(screen.getByText("已保存,重启后生效")).toBeTruthy();
    });
    expect(screen.getAllByText("重启生效").length).toBeGreaterThan(0);
  });

  it("未做变更时保存按钮禁用", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/settings")) {
        return json(SETTINGS_RESPONSE);
      }
      return json({});
    });
    renderPage(fetcher);

    await screen.findByDisplayValue("https://aw.example.com");
    await waitFor(() => {
      expect((screen.getByRole("button", { name: /保存/ }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
