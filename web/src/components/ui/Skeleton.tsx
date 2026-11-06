import type { CSSProperties } from "react";
import styles from "./controls.module.css";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** 圆形头像位 */
  circle?: boolean;
}

export function Skeleton({ width = "100%", height = 16, circle = false }: SkeletonProps) {
  const style: CSSProperties = {
    width,
    height,
    ...(circle ? { borderRadius: "var(--radius-full)" } : {}),
  };
  return <span className={styles.skeleton} style={style} aria-hidden="true" />;
}
