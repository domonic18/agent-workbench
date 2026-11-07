import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast.js";
import { AgentAccessPage } from "./AgentAccessPage.js";

function json(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const AGENT = {
  id: "agt_1",
  machineId: null,
  runtime: "workbuddy",
  project: "aw",
  displayName: "外接机器人",
  feishuAppId: null,
  feishuBotName: null,
  status: "active",
  allowedTargets: [],
  createdAt: 0,
  updatedAt: 0,
  key: "aw",
  usageLimit: null,
  machineHostname: null,
  machineDisplayName: null,
  totalRuns: 0,
  totalTokens: 0,
  openTasks: 0,
  lastRunAt: null,
};

function fakeFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.includes("/rotate")) {
      return json({ secret: "s3cret" });
    }
    if (path.includes("/api/agents")) {
      if (init?.method === "POST") {
        return json({ agent: AGENT, secret: "new-secret" });
      }
      return json({ items: [AGENT], nextCursor: null });
    }
    if (path.includes("/api/agent-kit/guide")) {
      return json({
        guide: "规范",
        skill: "skill",
        prompts: { receiver: "接收侧", senderTemplate: "发起侧" },
        publicUrl: "https://aw.example.com",
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
        <AgentAccessPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("协作接入页", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("给出接入参数与端点", async () => {
    vi.stubGlobal("fetch", fakeFetch());
    renderPage();

    expect(await screen.findByText("https://aw.example.com/mcp")).toBeTruthy();
    expect(screen.getByText("authorization")).toBeTruthy();
  });

  it("名册列出 Agent 并可轮换密钥，轮换后给出带凭据的配置片段", async () => {
    const fetcher = fakeFetch();
    vi.stubGlobal("fetch", fetcher);
    renderPage();

    expect(await screen.findByText("外接机器人")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /轮换密钥/ }));

    // 轮换走共用的密钥弹窗：先确认，再出明文
    const dialog = await screen.findByRole("dialog", { name: "轮换 Agent 密钥" });
    fireEvent.click(within(dialog).getByRole("button", { name: "轮换密钥" }));

    await waitFor(() => {
      const call = fetcher.mock.calls.find(([input]) => String(input).includes("/rotate"));
      expect(call).toBeDefined();
    });
    // 三块配置片段各带一次凭据
    const snippets = await screen.findAllByText(/Bearer agt_1\.s3cret/);
    expect(snippets).toHaveLength(3);
    expect(snippets[0]?.textContent).toContain("claude mcp add --transport http");
    expect(snippets[1]?.textContent).toContain("mcpServers");
    expect(snippets[2]?.textContent).toContain("Header 名: authorization");
  });

  it("没有明文密钥时不出配置片段", async () => {
    vi.stubGlobal("fetch", fakeFetch());
    renderPage();

    expect(await screen.findByText("外接机器人")).toBeTruthy();
    expect(screen.queryByText(/Bearer agt_1\./)).toBeNull();
  });
});
