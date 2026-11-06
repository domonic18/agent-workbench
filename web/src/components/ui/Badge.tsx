import type { ReactNode } from "react";
import type { Tone } from "../../shared/tone.js";
import styles from "./controls.module.css";

export interface BadgeProps {
  tone: Tone;
  text: ReactNode;
  icon?: ReactNode;
}

const TONE_CLASS: Record<Tone, string> = {
  positive: styles.tonePositive ?? "",
  warning: styles.toneWarning ?? "",
  danger: styles.toneDanger ?? "",
  info: styles.toneInfo ?? "",
  muted: styles.toneMuted ?? "",
};

/** 颜色 + 文本双编码，不单靠颜色传达状态（03 §4.1） */
export function Badge({ tone, text, icon }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${TONE_CLASS[tone]}`}>
      {icon}
      {text}
    </span>
  );
}
