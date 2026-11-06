import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMachine } from "../../api/identity.js";
import { MachineRegisterDialog } from "./MachineRegisterDialog.js";

vi.mock("../../api/identity.js", () => ({ createMachine: vi.fn() }));

describe("机器登记弹窗", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("提交机器信息后展示一次性采集器密钥", async () => {
    vi.mocked(createMachine).mockResolvedValue({
      machine: {
        id: "macmini-01",
        hostname: "mini",
        displayName: "mini",
        os: "macOS 15",
        collectorVersion: "0.1.0",
        lastSeenAt: null,
        status: "active",
        createdAt: 1_700_000_000_000,
      },
      secret: "collector_secret",
    });
    render(<MachineRegisterDialog onClose={() => {}} />);

    expect(screen.getByText(/未归因/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("collector_id"), {
      target: { value: " macmini-01 " },
    });
    fireEvent.change(screen.getByLabelText("主机名"), { target: { value: "mini" } });
    fireEvent.change(screen.getByLabelText("操作系统"), { target: { value: "macOS 15" } });
    fireEvent.change(screen.getByLabelText("采集器版本"), { target: { value: "0.1.0" } });
    fireEvent.submit(screen.getByRole("button", { name: "登记" }).closest("form")!);

    expect(await screen.findByText("collector_secret")).toBeTruthy();
    expect(createMachine).toHaveBeenCalledWith({
      id: "macmini-01",
      hostname: "mini",
      os: "macOS 15",
      collectorVersion: "0.1.0",
    });
    expect(screen.getByText(/AW_COLLECTOR_SECRET/)).toBeTruthy();
    expect(screen.getByText(/关闭后不可再查看/)).toBeTruthy();
  });

  it("服务端报错时留在表单", async () => {
    vi.mocked(createMachine).mockRejectedValue(new Error("boom"));
    render(<MachineRegisterDialog onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("collector_id"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText("主机名"), { target: { value: "box" } });
    fireEvent.change(screen.getByLabelText("操作系统"), { target: { value: "macOS" } });
    fireEvent.change(screen.getByLabelText("采集器版本"), { target: { value: "0.1.0" } });
    fireEvent.submit(screen.getByRole("button", { name: "登记" }).closest("form")!);

    expect(await screen.findByText("机器登记失败，请稍后再试")).toBeTruthy();
    expect(screen.getByLabelText("collector_id")).toBeTruthy();
  });
});
