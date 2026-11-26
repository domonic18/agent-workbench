import { Check } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils.js";

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
    <div className="inline-flex" ref={anchorRef}>
      {trigger({ open, toggle })}
      {open
        ? createPortal(
            <div
              className="fixed z-95 min-w-menu-min p-1 border border-border rounded-md bg-surface shadow-md"
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
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-2 border-none rounded-sm bg-transparent text-foreground text-sm text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
                      item.tone === "danger" && "text-danger",
                      item.disabled === true && "text-muted cursor-default hover:bg-transparent",
                    )}
                    disabled={item.disabled === true}
                    onClick={() => {
                      item.onSelect?.();
                      close(true);
                    }}
                  >
                    {item.icon === undefined ? null : (
                      <span className="inline-flex text-muted" aria-hidden="true">
                        {item.icon}
                      </span>
                    )}
                    {item.label}
                    {item.checked === true ? (
                      <span className="inline-flex ml-auto text-accent" aria-hidden="true">
                        <Check size={14} />
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <div key={item.key} className="px-3 py-2 text-muted text-2xs font-semibold tracking-wide uppercase" role="presentation">
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
