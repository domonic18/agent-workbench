import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./controls.module.css";

export interface TooltipProps {
  /** 气泡文案,也是触发元素的无障碍名 */
  label: string;
  /** 触发元素内容,一般是图标 */
  children: ReactNode;
}

/**
 * 轻量提示气泡:图标 + 悬浮/聚焦说明。
 * 气泡挂在 document.body 上按视口坐标定位,不会被表格滚动容器裁掉。
 */
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
    // 上方放不下就翻到下方;左右夹在视口内
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

  // 页面滚动后锚点失真,直接收起气泡
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
        className={styles.tooltipTrigger}
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
              className={styles.tooltipBubble}
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
