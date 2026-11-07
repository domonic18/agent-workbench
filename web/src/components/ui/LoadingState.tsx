import { Loader2 } from "lucide-react";
import styles from "./feedback.module.css";

export interface LoadingStateProps {
  label?: string;
}

/** 整屏加载态：居中 spinner + 一句说明 */
export function LoadingState({ label = "加载中…" }: LoadingStateProps) {
  return (
    <div className={styles.loading} role="status">
      <Loader2 size={22} strokeWidth={1.8} className={styles.loadingSpinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
