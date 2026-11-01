import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rotateAgentKey } from "../../api/identity.js";
import { AgentRotateDialog } from "./AgentRotateDialog.js";

vi.mock("../../api/identity.js", () => ({ rotateAgentKey: vi.fn() }));

describe("Agent 密钥轮换弹窗", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("轮换成功后只展示一次新密钥并禁用误触关闭", async () => {
    vi.mocked(rotateAgentKey).mockResolvedValue({ secret: "sec_once" });
    const onClose = vi.fn();
    render(
      <AgentRotateDialog
        agent={{ id: "agt_a", displayName: "构建 Agent", project: "aw" }}
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/旧密钥立即失效/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "轮换密钥" }));

    expect(await screen.findByText("sec_once")).toBeTruthy();
    expect(screen.getByText(/关闭后不可再查看/)).toBeTruthy();
    expect(rotateAgentKey).toHaveBeenCalledWith("agt_a");
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("轮换失败时保留确认界面并显示服务端消息", async () => {
    vi.mocked(rotateAgentKey).mockRejectedValue(new Error("网络异常"));
    render(
      <AgentRotateDialog
        agent={{ id: "agt_a", displayName: "构建 Agent", project: "aw" }}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "轮换密钥" }));
    expect(await screen.findByText("密钥轮换失败，请稍后再试")).toBeTruthy();
    expect(screen.getByRole("button", { name: "轮换密钥" })).toBeTruthy();
  });
});
