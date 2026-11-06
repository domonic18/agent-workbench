import { AlertTriangle } from "lucide-react";
import { Button } from "./Button.js";
import styles from "./feedback.module.css";

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

/** 错误态卡片：说明出了什么事，并给出重试入口 */
export function ErrorState({ title = "加载失败", message, onRetry }: ErrorStateProps) {
  return (
    <div className={styles.errorState} role="alert">
      <AlertTriangle size={20} strokeWidth={1.8} className={styles.errorStateIcon} aria-hidden="true" />
      <span className={styles.errorStateTitle}>{title}</span>
      <span className={styles.errorStateMessage}>{message}</span>
      {onRetry === undefined ? null : (
        <div className={styles.errorStateAction}>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            重试
          </Button>
        </div>
      )}
    </div>
  );
}
