import type { Tone } from "../../shared/labels.js";
import styles from "./StatusBadge.module.css";

export interface StatusBadgeProps {
  tone: Tone;
  text: string;
}

/** 颜色 + 文本双编码,不单靠颜色传达状态(03 §4.1) */
export function StatusBadge({ tone, text }: StatusBadgeProps) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{text}</span>;
}
