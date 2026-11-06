import type { ReactNode } from "react";
import styles from "./surfaces.module.css";

export interface StatCardProps {
  /** 微标签：短、大写、弱化 */
  label: string;
  value: ReactNode;
  /** 数值下方的补充说明 */
  sub?: ReactNode;
  icon?: ReactNode;
  /** 悬停提示（精确值等） */
  title?: string;
}

/** 指标卡：一眼看清一个数，不承载操作 */
export function StatCard({ label, value, sub, icon, title }: StatCardProps) {
  return (
    <div className={styles.stat} title={title}>
      <div className={styles.statHead}>
        <span className={styles.statLabel}>{label}</span>
        {icon === undefined ? null : (
          <span className={styles.statIcon} aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div className={styles.statValue}>{value}</div>
      {sub === undefined ? null : <div className={styles.statDesc}>{sub}</div>}
    </div>
  );
}
