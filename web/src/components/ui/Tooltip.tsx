import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface TooltipProps {
  /** 气泡文案,也是触发元素的无障碍名 */
  label: string;
  /** 触发元素内容,一般是图标 */
  children: ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const tooltipId = useId();

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (trigger === null || bubble === null) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const above = rect.top - bubbleRect.height - 8;
    const top = above >= 8 ? above : rect.bottom + 8;
    const left = Math.max(
      8,
      Math.min(
        rect.left + rect.width / 2 - bubbleRect.width / 2,
        window.innerWidth - bubbleRect.width - 8,
      ),
    );
    setAnchor({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (): void => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex items-center justify-center text-muted cursor-help focus-visible:outline-none focus-visible:rounded-xs focus-visible:ring"
        role="img"
        tabIndex={0}
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <span
              ref={bubbleRef}
              id={tooltipId}
              role="tooltip"
              className="fixed z-90 w-max max-w-tooltip-max px-3 py-2 border border-border rounded-md bg-surface text-foreground text-xs leading-relaxed shadow-md pointer-events-none"
              style={anchor === null ? { visibility: "hidden" } : { top: anchor.top, left: anchor.left }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
