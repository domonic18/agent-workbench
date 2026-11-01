import { type ReactNode, useEffect } from "react";
import styles from "./Modal.module.css";

export interface ModalProps {
  title: string;
  onClose: () => void;
  /** 一次性密钥展示后禁用,避免误触丢失 */
  dismissible?: boolean;
  children: ReactNode;
}

export function Modal({ title, onClose, dismissible = true, children }: ModalProps) {
  useEffect(() => {
    if (!dismissible) {
      return undefined;
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [dismissible, onClose]);

  return (
    <div
      className={styles.overlay}
      onClick={() => {
        if (dismissible) {
          onClose();
        }
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          {dismissible ? (
            <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
              ×
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}
