import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, type MenuItem } from "./Menu.js";

afterEach(() => {
  cleanup();
});

const ITEMS: MenuItem[] = [
  { key: "heading", heading: "外观" },
  { key: "light", label: "明亮", checked: true },
  { key: "dark", label: "暗黑" },
];

function renderMenu(items: MenuItem[] = ITEMS): void {
  render(
    <Menu
      label="账号菜单"
      items={items}
      trigger={({ open, toggle }) => (
        <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          打开
        </button>
      )}
    />,
  );
}

describe("Menu", () => {
  it("触发器同步 aria-expanded，菜单未打开时不渲染", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "打开" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("Esc 关闭菜单并把焦点还给触发器", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "打开" });
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("点击菜单外部关闭菜单", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("选中项触发回调并关闭菜单", () => {
    const onSelect = vi.fn();
    renderMenu([
      { key: "light", label: "明亮", onSelect },
      { key: "dark", label: "暗黑" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    fireEvent.click(screen.getByRole("menuitem", { name: "明亮" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("带 checked 的项渲染为单选并给出选中态", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    const radio = screen.getByRole("menuitemradio", { name: "明亮" });
    expect(radio.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "暗黑" })).toBeTruthy();
  });

  it("分组标题不作为交互项", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    expect(screen.getByText("外观")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "外观" })).toBeNull();
  });
});
