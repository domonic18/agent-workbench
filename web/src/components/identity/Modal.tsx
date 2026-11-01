import { type ReactNode, useEffect, useRef } from "react";
import styles from "./Modal.module.css";

export interface ModalProps {
  title: string;
  onClose: () => void;
  /** 一次性密钥展示后禁用,避免误触丢失 */
  dismissible?: boolean;
  children: ReactNode;
}

export function Modal({ title, onClose, dismissible = true, children }: ModalProps) {
  // 监听只注册一次并读最新 dismissible:密钥揭示后即使旧闭包尚未清理,Esc 也不会误关
  const dismissibleRef = useRef(dismissible);
  const onCloseRef = useRef(onClose);
  dismissibleRef.current = dismissible;
  onCloseRef.current = onClose;

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape" && dismissibleRef.current) {
        onCloseRef.current();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

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
