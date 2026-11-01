import styles from "./MetricCard.module.css";

export interface MetricCardProps {
  label: string;
  value: string;
  title?: string;
}

export function MetricCard({ label, value, title }: MetricCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value} title={title}>
        {value}
      </div>
    </div>
  );
}
