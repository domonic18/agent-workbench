import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast.js";
import { OnboardingPage } from "./OnboardingPage.js";

function json(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** 三条接口各给各的形状：产物目录、令牌签发、执行机发现 */
function fakeFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/api/bootstrap/artifacts")) {
      return json({
        publicUrl: null,
        assets: [
          {
            name: "aw-node-macos-arm64",
            label: "Apple 芯片(macOS arm64)",
            size: 89_225_954,
            sha256: "a".repeat(64),
          },
        ],
      });
    }
    if (path.includes("/api/bootstrap/enroll-token")) {
      return json({ token: "ott_demo_token", expiresAt: Date.now() + 15 * 60 * 1000 });
    }
    if (path.includes("/api/bootstrap/discovery")) {
      const now = Date.now();
      return json({
        machines: [
          {
            machineId: "mch_1",
            hostname: "build-box",
            status: "active",
            lastSeenAt: now - 60_000,
            receivedAt: now - 3_600_000,
            projects: [
              { name: "aw", confirmed: false },
              { name: "cli", confirmed: false },
            ],
          },
        ],
      });
    }
    if (path.includes("/api/bootstrap/agents")) {
      return json({ agents: [{ id: "agt_1", key: "k", project: "aw", displayName: "aw" }] });
    }
    return json({});
  });
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <OnboardingPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function gotoStep(index: number): Promise<void> {
  for (let i = 0; i < index; i += 1) {
    const next = screen.getByRole("button", { name: "下一步" });
    next.click();
  }
}

describe("接入执行机页", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("第一步给平台直链与一键安装命令", async () => {
    vi.stubGlobal("fetch", fakeFetch());
    renderPage();

    expect(await screen.findByText("选择平台产物")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "下载" });
    expect(link.getAttribute("href")).toContain("/artifacts/aw-node-macos-arm64");
    expect(screen.getByText(/artifacts\/install\.sh/)).toBeTruthy();
  });

  it("安装命令里不含令牌，令牌单独签发并带倒计时", async () => {
    vi.stubGlobal("fetch", fakeFetch());
    renderPage();

    await screen.findByText("选择平台产物");
    await gotoStep(1);
    expect(screen.getByText(/artifacts\/install\.sh/)).toBeTruthy();
    expect(screen.queryByText("ott_demo_token")).toBeNull();

    screen.getByRole("button", { name: "签发 enroll token" }).click();
    expect(await screen.findByText("ott_demo_token")).toBeTruthy();
    expect(screen.getByText("剩余有效期")).toBeTruthy();
  });

  it("第三步列出已上线执行机", async () => {
    vi.stubGlobal("fetch", fakeFetch());
    renderPage();

    await screen.findByText("选择平台产物");
    await gotoStep(2);
    expect(await screen.findByText("build-box")).toBeTruthy();
    expect(screen.getByText("已激活")).toBeTruthy();
  });

  it("执行机清单分开显示心跳与发现上报时间", async () => {
    vi.stubGlobal("fetch", fakeFetch());
    renderPage();

    await screen.findByText("选择平台产物");
    await gotoStep(2);
    const row = await screen.findByText("build-box");
    const sub = row.nextElementSibling?.textContent ?? "";
    expect(sub).toContain("心跳 1 分钟前");
    expect(sub).toContain("发现 1 小时前");
  });

  it("按机器把待登记项目登记为 Agent", async () => {
    const fetcher = fakeFetch();
    vi.stubGlobal("fetch", fetcher);
    renderPage();

    await screen.findByText("选择平台产物");
    await gotoStep(2);
    const button = await screen.findByRole("button", { name: "登记为 Agent" });
    button.click();

    await waitFor(() => {
      const call = fetcher.mock.calls.find(([input]) =>
        String(input).includes("/api/bootstrap/agents"),
      );
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit | undefined;
      expect(JSON.parse(String(init?.body))).toEqual({
        machineId: "mch_1",
        agents: [{ project: "aw" }, { project: "cli" }],
      });
    });
    expect(await screen.findByText("已登记 2 个 Agent")).toBeTruthy();
  });

  it("取消勾选的项目不进登记请求", async () => {
    const fetcher = fakeFetch();
    vi.stubGlobal("fetch", fetcher);
    renderPage();

    await screen.findByText("选择平台产物");
    await gotoStep(2);
    await screen.findByText("build-box");
    const cli = screen.getByText("cli").closest("label")?.querySelector("input");
    fireEvent.click(cli as HTMLInputElement);
    screen.getByRole("button", { name: "登记为 Agent" }).click();

    await waitFor(() => {
      const call = fetcher.mock.calls.find(([input]) =>
        String(input).includes("/api/bootstrap/agents"),
      );
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit | undefined;
      expect(JSON.parse(String(init?.body)).agents).toEqual([{ project: "aw" }]);
    });
  });

  it("一个项目都不选时不发登记请求", async () => {
    const fetcher = fakeFetch();
    vi.stubGlobal("fetch", fetcher);
    renderPage();

    await screen.findByText("选择平台产物");
    await gotoStep(2);
    await screen.findByText("build-box");
    for (const name of ["aw", "cli"]) {
      const box = screen.getByText(name).closest("label")?.querySelector("input");
      fireEvent.click(box as HTMLInputElement);
    }
    screen.getByRole("button", { name: "登记为 Agent" }).click();

    expect(await screen.findByText("至少选一个项目")).toBeTruthy();
    const posted = fetcher.mock.calls.some(([input]) =>
      String(input).includes("/api/bootstrap/agents"),
    );
    expect(posted).toBe(false);
  });
});
