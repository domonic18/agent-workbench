import type { ReactNode } from "react";
import type { Tone } from "../../shared/tone.js";
import styles from "./controls.module.css";

export interface ToneIconProps {
  tone: Tone;
  icon: ReactNode;
}

const TONE_CLASS = {
  positive: styles.toneIconPositive,
  warning: styles.toneIconWarning,
  danger: styles.toneIconDanger,
  info: styles.toneIconInfo,
  muted: styles.toneIconMuted,
} as const;

/** 语义色图标：颜色 + 旁边的文案双编码，不靠颜色单独表意 */
export function ToneIcon({ tone, icon }: ToneIconProps) {
  return (
    <span className={`${styles.toneIcon} ${TONE_CLASS[tone]}`} aria-hidden="true">
      {icon}
    </span>
  );
}
