import type { ReactNode } from "react";
import styles from "./surfaces.module.css";

export interface PageFooterProps {
  children: ReactNode;
}

/** 页底说明：交代可见性边界这类「不随数据变化」的话 */
export function PageFooter({ children }: PageFooterProps) {
  return <p className={styles.pageFooter}>{children}</p>;
}
