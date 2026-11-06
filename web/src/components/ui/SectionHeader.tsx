import type { ReactNode } from "react";
import styles from "./surfaces.module.css";

export interface SectionHeaderProps {
  title: ReactNode;
  /** 标题旁的一句说明 */
  hint?: ReactNode;
  /** 右侧操作区 */
  actions?: ReactNode;
}

/** 分区标题：统一各页的标题层级与操作位 */
export function SectionHeader({ title, hint, actions }: SectionHeaderProps) {
  return (
    <div className={styles.sectionHeader}>
      <div className={styles.sectionHeading}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {hint === undefined ? null : <span className={styles.sectionHint}>{hint}</span>}
      </div>
      {actions === undefined ? null : <div className={styles.sectionActions}>{actions}</div>}
    </div>
  );
}
