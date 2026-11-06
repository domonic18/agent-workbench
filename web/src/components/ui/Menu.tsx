import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./overlays.module.css";

export interface MenuItem {
  key: string;
  /** 交互项的文字；分组标题项可不给 */
  label?: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  /** 有值即渲染为单选项（menuitemradio） */
  checked?: boolean;
  tone?: "default" | "danger";
  /** 分组标题，非交互项 */
  heading?: string;
  /** 只读项（如账号信息），不可点 */
  disabled?: boolean;
}

export interface MenuTriggerState {
  open: boolean;
  toggle: () => void;
}

export interface MenuProps {
  /** 无障碍名 */
  label: string;
  /** 触发元素；用 open 同步 aria-expanded */
  trigger: (state: MenuTriggerState) => ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
}

interface Position {
  top: number;
  left: number;
}

/**
 * 下拉菜单：非模态，不加遮罩、不锁滚动（与 Dialog 的取舍不同，故不复用）。
 *
 * 行为：Esc 关闭、外部点击关闭、关闭后焦点回到触发器、上下键在项间移动。
 */
export function Menu({ label, trigger, items, align = "start" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (!returnFocus) {
      return;
    }
    const anchor = anchorRef.current;
    const focusable = anchor?.querySelector<HTMLElement>("button, [href], input, select, textarea");
    focusable?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const anchor = anchorRef.current?.getBoundingClientRect();
    const menu = menuRef.current?.getBoundingClientRect();
    if (anchor === undefined || menu === undefined) {
      return;
    }
    let top = anchor.bottom + 6;
    if (top + menu.height > window.innerHeight - 8) {
      top = Math.max(8, anchor.top - menu.height - 6);
    }
    const rawLeft = align === "end" ? anchor.right - menu.width : anchor.left;
    const left = Math.min(Math.max(8, rawLeft), window.innerWidth - menu.width - 8);
    setPosition({ top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointer(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (target === null) {
        return;
      }
      if (menuRef.current?.contains(target) === true || anchorRef.current?.contains(target) === true) {
        return;
      }
      close(false);
    }
    function handleKey(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      const menu = menuRef.current;
      if (menu === null) {
        return;
      }
      const options = Array.from(menu.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled])"));
      if (options.length === 0) {
        return;
      }
      event.preventDefault();
      const current = options.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % options.length
          : (current - 1 + options.length) % options.length;
      options[next]?.focus();
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const menu = menuRef.current;
    menu?.querySelector<HTMLElement>("[role^='menuitem']:not([disabled])")?.focus();
  }, [open]);

  return (
    <div className={styles.menuAnchor} ref={anchorRef}>
      {trigger({ open, toggle })}
      {open
        ? createPortal(
            <div
              className={styles.menu}
              role="menu"
              aria-label={label}
              style={{ top: position.top, left: position.left }}
              ref={menuRef}
            >
              {items.map((item) =>
                item.heading === undefined ? (
                  <button
                    key={item.key}
                    type="button"
                    role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                    aria-checked={item.checked === undefined ? undefined : item.checked}
                    className={`${styles.menuItem} ${item.tone === "danger" ? styles.menuItemDanger : ""} ${item.disabled === true ? styles.menuItemDisabled : ""}`}
                    disabled={item.disabled === true}
                    onClick={() => {
                      item.onSelect?.();
                      close(true);
                    }}
                  >
                    {item.icon === undefined ? null : (
                      <span className={styles.menuItemIcon} aria-hidden="true">
                        {item.icon}
                      </span>
                    )}
                    {item.label}
                  </button>
                ) : (
                  <div key={item.key} className={styles.menuHeading} role="presentation">
                    {item.heading}
                  </div>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
