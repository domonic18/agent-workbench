import type { ReactNode } from "react";
import styles from "./feedback.module.css";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** 引导动作，如「接入执行机」 */
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      {icon === undefined ? null : (
        <div className={styles.emptyIcon} aria-hidden="true">
          {icon}
        </div>
      )}
      <div className={styles.emptyTitle}>{title}</div>
      {description === undefined ? null : (
        <div className={styles.emptyDescription}>{description}</div>
      )}
      {action === undefined ? null : <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}
