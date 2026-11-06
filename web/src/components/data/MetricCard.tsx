import type { ReactNode } from "react";
import styles from "./MetricCard.module.css";

export interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  title?: string;
  /** 指标图标：与数值一起构成视觉锚 */
  icon?: ReactNode;
}

export function MetricCard({ label, value, sub, title, icon }: MetricCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.label}>
        {icon === undefined ? null : (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )}
        {label}
      </div>
      <div className={styles.value} title={title}>
        {value}
      </div>
      {sub === undefined ? null : <div className={styles.sub}>{sub}</div>}
    </div>
  );
}
