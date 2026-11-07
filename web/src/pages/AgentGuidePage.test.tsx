import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast.js";
import { AgentGuidePage } from "./AgentGuidePage.js";

function json(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const GUIDE = [
  "# A2A 协作规范",
  "",
  "## 五、接收侧六步",
  "",
  "| 工具 | 闸门 |",
  "|---|---|",
  "| `a2a_inbox` | L0 |",
].join("\n");

function fakeFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async () =>
    json({
      guide: GUIDE,
      skill: "---\nname: aw-a2a\n---\n",
      prompts: { receiver: "接收侧提示词正文", senderTemplate: "发起侧提示词正文" },
      publicUrl: "https://aw.example.com",
    }),
  );
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AgentGuidePage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Agent 手册页", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("渲染规范正文与工具速查表", async () => {
    vi.stubGlobal("fetch", fakeFetch());
    renderPage();

    expect(await screen.findByText(/接收侧六步/)).toBeTruthy();
    expect(screen.getByText("a2a_inbox")).toBeTruthy();
  });

  it("给出下载 SKILL.md 的直链", async () => {
    vi.stubGlobal("fetch", fakeFetch());
    renderPage();

    const link = await screen.findByRole("link", { name: /下载 SKILL.md/ });
    expect(link.getAttribute("href")).toBe("/api/agent-kit/skill");
  });

  it("给出接收侧与发起侧两份工作区提示词", async () => {
    vi.stubGlobal("fetch", fakeFetch());
    renderPage();

    expect(await screen.findByText("接收侧提示词正文")).toBeTruthy();
    expect(screen.getByText("发起侧提示词正文")).toBeTruthy();
  });
});
