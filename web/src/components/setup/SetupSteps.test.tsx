import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapStatus } from "../../api/bootstrap.js";

const bootstrap = await import("../../api/bootstrap.js");
vi.mock("../../api/bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/bootstrap.js")>();
  return { ...actual, issueEnrollToken: vi.fn() };
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("StepMachine", () => {
  it("安装命令指向控制台下发的安装脚本,不含令牌", () => {
    render(<StepMachine step={2} status={STATUS} />);
    const command = screen.getByLabelText("在目标机执行") as HTMLTextAreaElement;
    expect(command.value).toContain("/artifacts/install.sh");
    expect(command.value).toContain("sh -s -- --url");
    expect(command.value).not.toContain("ott_");
  });

  it("签发的令牌单独展示,安装命令不随令牌变化", async () => {
    vi.mocked(bootstrap.issueEnrollToken).mockResolvedValueOnce({ token: "ott_abc123", expiresAt: 1 });
    render(<StepMachine step={2} status={STATUS} />);
    fireEvent.click(screen.getByRole("button", { name: "签发 enroll token" }));
    await waitFor(() => expect(screen.getByLabelText(/enroll token/)).toBeTruthy());
    expect((screen.getByLabelText(/enroll token/) as HTMLTextAreaElement).value).toBe("ott_abc123");
    const command = screen.getByLabelText("在目标机执行") as HTMLTextAreaElement;
    expect(command.value).not.toContain("ott_abc123");
  });
});
