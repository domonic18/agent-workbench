import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapStatus } from "../../api/bootstrap.js";
import { ToastProvider } from "../ui/Toast.js";

const bootstrap = await import("../../api/bootstrap.js");
vi.mock("../../api/bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/bootstrap.js")>();
  return {
    ...actual,
    issueEnrollToken: vi.fn(),
    fetchArtifacts: vi.fn(async () => ({ publicUrl: null, assets: [] })),
    fetchDiscovery: vi.fn(async () => ({ machines: [] })),
  };
});

import { StepMachine } from "./SetupSteps.js";

const STATUS: BootstrapStatus = {
  phase: "awaiting_machine",
  machines: 0,
  agents: 0,
  assembly: null,
  definition: {
    workKind: "bug_fix",
    routeRule: { ruleId: "r", source: "bug", kind: "submitted", targetRole: "primary" },
    mandate: { expectedResult: "e", scope: "s" },
    evidence: [],
  },
  next: "添加执行机",
};

/** 安装命令以代码块呈现，全站可能多处出现 */
function commandBlocks(): HTMLElement[] {
  return screen.getAllByText(/artifacts\/install\.sh/) as HTMLElement[];
}

function renderStep(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <StepMachine status={STATUS} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("StepMachine", () => {
  it("安装命令指向控制台下发的安装脚本,不含令牌", () => {
    renderStep();
    const blocks = commandBlocks();
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.textContent).toContain("sh -s -- --url");
      expect(block.textContent).not.toContain("ott_");
    }
  });

  it("签发的令牌单独展示,安装命令不随令牌变化", async () => {
    vi.mocked(bootstrap.issueEnrollToken).mockResolvedValueOnce({
      token: "ott_abc123",
      expiresAt: Date.now() + 60_000,
    });
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: "签发 enroll token" }));
    await waitFor(() => expect(screen.getByText("ott_abc123")).toBeTruthy());
    for (const block of commandBlocks()) {
      expect(block.textContent).not.toContain("ott_abc123");
    }
  });
});
