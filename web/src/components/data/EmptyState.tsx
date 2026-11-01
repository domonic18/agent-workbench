import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  title: string;
  description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.title}>{title}</div>
      {description === undefined ? null : <div className={styles.description}>{description}</div>}
    </div>
  );
}
