import type { ReactNode } from "react";
import styles from "./surfaces.module.css";

export interface PanelProps {
  title?: ReactNode;
  description?: ReactNode;
  /** 标题行右侧动作区 */
  actions?: ReactNode;
  /** 底部动作条 */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** 带标题/说明/动作区的容器，页面分区统一用它 */
export function Panel({ title, description, actions, footer, children, className }: PanelProps) {
  const classes = className === undefined ? styles.panel : `${styles.panel} ${className}`;
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;
  return (
    <section className={classes}>
      {hasHeader ? (
        <div className={styles.panelHeader}>
          <div>
            {title === undefined ? null : <h2 className={styles.panelTitle}>{title}</h2>}
            {description === undefined ? null : (
              <p className={styles.panelDescription}>{description}</p>
            )}
          </div>
          {actions === undefined ? null : <div className={styles.panelActions}>{actions}</div>}
        </div>
      ) : null}
      <div className={styles.panelBody}>{children}</div>
      {footer === undefined ? null : <div className={styles.panelFooter}>{footer}</div>}
    </section>
  );
}

export interface CardProps {
  children: ReactNode;
  className?: string;
}

/** 无标题的浅容器 */
export function Card({ children, className }: CardProps) {
  return (
    <div className={className === undefined ? styles.card : `${styles.card} ${className}`}>
      {children}
    </div>
  );
}
