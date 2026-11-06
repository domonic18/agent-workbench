import { X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton.js";
import styles from "./surfaces.module.css";

export type DialogSize = "sm" | "md" | "lg" | "xl";

export interface DialogProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  /** 一次性密钥展示后置 false，避免误触关闭丢失内容 */
  dismissible?: boolean;
  size?: DialogSize;
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
  footer,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 监听只注册一次并读最新值：密钥揭示后即使旧闭包尚未清理，Esc 也不会误关
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

  return createPortal(
    <div
      className={`${styles.overlay} ${
        size === "lg" || size === "xl" ? styles.overlayWide : ""
      }`}
      onClick={() => {
        if (dismissible) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={panelRef}
        className={`${styles.dialog} ${styles[size]}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        onKeyDown={handleTab}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.dialogHeader}>
          <div>
            <h2 className={styles.dialogTitle}>{title}</h2>
            {description === undefined ? null : (
              <p className={styles.dialogDescription}>{description}</p>
            )}
          </div>
          {dismissible ? (
            <IconButton label="关闭" icon={<X size={16} aria-hidden="true" />} onClick={onClose} />
          ) : null}
        </div>
        <div className={styles.dialogBody}>{children}</div>
        {footer === undefined ? null : <div className={styles.dialogFooter}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
