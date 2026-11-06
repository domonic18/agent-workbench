import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
      return json({
        machines: [
          {
            machineId: "mch_1",
            hostname: "build-box",
            status: "active",
            receivedAt: Date.now(),
            projects: [{ name: "aw", confirmed: true }],
          },
        ],
      });
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
});
