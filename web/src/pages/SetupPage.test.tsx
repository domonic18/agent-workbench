import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";
import { ToastProvider } from "../components/ui/Toast.js";

const bootstrap = await import("../api/bootstrap.js");
vi.mock("../api/bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/bootstrap.js")>();
  return {
    ...actual,
    bootstrapStatus: vi.fn(),
    bootstrapAdmin: vi.fn(),
    issueEnrollToken: vi.fn(),
    fetchDiscovery: vi.fn(async () => ({ machines: [] })),
    fetchArtifacts: vi.fn(async () => ({ publicUrl: null, assets: [] })),
    confirmAgents: vi.fn(),
    runPreflight: vi.fn(),
    completeSetup: vi.fn(),
  };
});

vi.mock("../api/identity.js", () => ({
  fetchAgents: vi.fn(async () => []),
}));

import { SetupPage } from "./SetupPage.js";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/setup"]}>
        <ToastProvider>
          <SetupPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const DEFINITION = {
  workKind: "bug_fix",
  routeRule: { ruleId: "default-bug-fix", source: "bug", kind: "submitted", targetRole: "primary" },
  mandate: { expectedResult: "修复缺陷并提交 PR", scope: "原始 Bug 反馈为范围" },
  evidence: ["PR 链接", "CI 全部通过", "接受回执"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SetupPage", () => {
  it("bootstrap mode(401)展示第 1 步初始化表单", async () => {
    vi.mocked(bootstrap.bootstrapStatus).mockRejectedValueOnce(new ApiError(401, "UNAUTHORIZED", "未初始化"));
    renderPage();
    await waitFor(() => expect(screen.getByText("初始化控制台")).toBeTruthy());
  });

  it("awaiting_machine 展示第 2 步添加执行机", async () => {
    vi.mocked(bootstrap.bootstrapStatus).mockResolvedValueOnce({
      phase: "awaiting_machine",
      machines: 0,
      agents: 0,
      assembly: null,
      definition: DEFINITION,
      next: "添加执行机",
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("添加执行机")).toBeTruthy());
  });

  it("ready 展示完成页与预检清单", async () => {
    vi.mocked(bootstrap.bootstrapStatus).mockResolvedValueOnce({
      phase: "ready",
      machines: 1,
      agents: 1,
      assembly: { primaryAgentId: "agt_1", workKind: "bug_fix", assembledAt: 1 },
      definition: DEFINITION,
      next: "初始化完成",
    });
    vi.mocked(bootstrap.runPreflight).mockResolvedValueOnce({
      items: [
        { key: "database", status: "ok", detail: "数据库正常" },
        { key: "bug_source", status: "not_configured", detail: "未配置" },
      ],
      ready: true,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("初始化完成")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("数据库正常")).toBeTruthy());
  });

  it("第 1 步提交初始化调用 bootstrapAdmin", async () => {
    vi.mocked(bootstrap.bootstrapStatus).mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "未初始化"));
    vi.mocked(bootstrap.bootstrapAdmin).mockResolvedValue({ ok: true });
    renderPage();
    await waitFor(() => expect(screen.getByText("初始化控制台")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("bootstrap token"), { target: { value: "ott_x" } });
    fireEvent.change(screen.getByLabelText("管理员口令"), { target: { value: "secret-123" } });
    fireEvent.click(screen.getByRole("button", { name: "设置口令并继续" }));
    await waitFor(() =>
      expect(bootstrap.bootstrapAdmin).toHaveBeenCalledWith("ott_x", "secret-123"),
    );
  });
});
