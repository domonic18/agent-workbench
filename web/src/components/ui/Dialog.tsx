import { X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils.js";
import { IconButton } from "./IconButton.js";

export type DialogSize = "sm" | "md" | "lg" | "xl";
export type DialogVariant = "center" | "drawer";

export interface DialogProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  /** 一次性密钥展示后置 false，避免误触关闭丢失内容 */
  dismissible?: boolean;
  size?: DialogSize;
  /** 抽屉：贴右侧滑出，窄屏占满整屏 */
  variant?: DialogVariant;
  /** 无障碍名；不给时用 title（字符串时） */
  ariaLabel?: string;
  /** 标题行右侧附加内容（状态徽章等） */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  description,
  onClose,
  dismissible = true,
  size = "md",
  variant = "center",
  ariaLabel,
  headerExtra,
  footer,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dismissibleRef = useRef(dismissible);
  const onCloseRef = useRef(onClose);
  dismissibleRef.current = dismissible;
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel).focus();
  }, []);

  useEffect(() => {
    function handleKey(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape" && dismissibleRef.current) {
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function handleTab(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Tab") {
      return;
    }
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (item) => !item.hasAttribute("hidden"),
    );
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const head = items[0];
    const tail = items[items.length - 1];
    if (head === undefined || tail === undefined) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === head || active === panel)) {
      event.preventDefault();
      tail.focus();
    } else if (!event.shiftKey && active === tail) {
      event.preventDefault();
      head.focus();
    }
  }

  const drawer = variant === "drawer";
  const wide = size === "lg" || size === "xl";

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-60 bg-overlay animate-fade",
        drawer ? "flex items-stretch justify-end" : "flex items-center justify-center p-5 max-md:p-0",
      )}
      onClick={() => {
        if (dismissible) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          "flex flex-col w-full max-h-[88vh] bg-surface border border-border rounded-lg shadow-lg animate-rise outline-none",
          !drawer && [
            size === "sm" && "max-w-dialog-sm",
            size === "md" && "max-w-dialog-md",
            size === "lg" && "max-w-dialog-lg",
            size === "xl" && "max-w-dialog-xl",
            wide && "max-md:max-w-none max-md:h-full max-md:max-h-full max-md:rounded-none max-md:border-none",
          ],
          drawer && "w-[min(var(--drawer-w),100%)] max-w-drawer h-full max-h-full rounded-l-lg rounded-r-none border-r-none max-md:max-w-none max-md:rounded-none max-md:border-none",
        )}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
        tabIndex={-1}
        onKeyDown={handleTab}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line-soft">
          <div className="min-w-0">
            <h2 className="m-0 text-lg font-bold">{title}</h2>
            {description === undefined ? null : (
              <p className="mt-1 mb-0 text-sm text-muted">{description}</p>
            )}
          </div>
          {headerExtra === undefined ? null : (
            <div className="flex flex-shrink-0 items-center gap-2">{headerExtra}</div>
          )}
          {dismissible ? (
            <IconButton label="关闭" icon={<X size={16} aria-hidden="true" />} onClick={onClose} />
          ) : null}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">{children}</div>
        {footer === undefined ? null : <div className="flex justify-end gap-2 px-5 py-3 border-t border-line-soft bg-surface-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
