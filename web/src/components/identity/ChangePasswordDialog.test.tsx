import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changePassword } from "../../api/auth.js";
import { ApiError } from "../../api/client.js";
import { ToastProvider } from "../ui/Toast.js";
import { ChangePasswordDialog } from "./ChangePasswordDialog.js";

vi.mock("../../api/auth.js", () => ({ changePassword: vi.fn() }));

function fill(current: string, next: string, confirm: string): void {
  fireEvent.change(screen.getByLabelText(/^当前口令/), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^新口令/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/确认新口令/), { target: { value: confirm } });
}

function renderDialog(onClose = vi.fn()): void {
  render(
    <ToastProvider>
      <ChangePasswordDialog onClose={onClose} />
    </ToastProvider>,
  );
}

describe("修改管理员口令弹窗", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("提交成功后提示吊销的其他设备会话数并关闭", async () => {
    vi.mocked(changePassword).mockResolvedValue({ ok: true, revokedSessions: 2 });
    const onClose = vi.fn();
    renderDialog(onClose);

    fill("secret123", "newsecret", "newsecret");
    fireEvent.click(screen.getByRole("button", { name: "修改口令" }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith("secret123", "newsecret");
    });
    expect(await screen.findByText("口令已更新,已吊销 2 个其他设备的登录态")).toBeTruthy();
    expect(onClose).toHaveBeenCalled();
  });

  it("两次新口令不一致时本地拦下,不发请求", async () => {
    renderDialog();

    fill("secret123", "newsecret", "other");
    fireEvent.click(screen.getByRole("button", { name: "修改口令" }));

    expect(await screen.findByText("两次输入的新口令不一致")).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("新口令太短时本地拦下", async () => {
    renderDialog();

    fill("secret123", "123", "123");
    fireEvent.click(screen.getByRole("button", { name: "修改口令" }));

    expect(await screen.findByText("新口令至少 6 位")).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("服务端报错时保留表单并显示服务端消息", async () => {
    vi.mocked(changePassword).mockRejectedValue(
      new ApiError(422, "VALIDATION_FAILED", "当前口令不正确"),
    );
    renderDialog();

    fill("wrong", "newsecret", "newsecret");
    fireEvent.click(screen.getByRole("button", { name: "修改口令" }));

    expect(await screen.findByText("当前口令不正确")).toBeTruthy();
    expect(screen.getByRole("button", { name: "修改口令" })).toBeTruthy();
  });
});
